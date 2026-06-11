/// <reference types="vite/client" />
import { supabase } from '@/lib/supabaseClient';
import { CONTRACT_TEMPLATE_OPTIONS } from './contracts';
import { BUILT_IN_TEMPLATES, fillTemplateWithAnswers, generateDeterministicContractDraft } from './contractDrafts';
import type {
  ClauseExplanation,
  ContractRecommendation,
  ContractTemplateOption,
  ContractWizardAnswers,
  RiskReviewResult,
  TemplateQuestion,
  LocalContractFieldSchema,
  LocalContractTemplate,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787';
// Add VITE_ANTHROPIC_API_KEY to your .env file to enable direct AI calls
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || '';
const DEMO_USER_KEY = 'own_masters_demo_user';

// ── Template analysis cache (avoids re-running AI on every render) ────────────
const templateAnalysisCache = new Map<string, {
  questions: TemplateQuestion[];
  templateText: string;
}>();

// ── Keyword map for rule-based recommendation ─────────────────────────────────
const keywordMap: Record<string, string[]> = {
  'split-sheet': ['split', 'splits', 'writer', 'songwriter', 'percentage', 'ownership', 'collaborator'],
  'artist-producer-agreement': ['producer', 'beat', 'track', 'artist', 'recording', 'royalty', 'points'],
  'producer-royalty-agreement': ['producer', 'royalty', 'royalties', 'points', 'net receipts', 'payment'],
  'artist-management-agreement': ['manager', 'management', 'commission', 'career'],
  'recording-agreement': ['record', 'recording', 'album', 'single', 'masters', 'deliverables', 'label'],
  'master-use-license': ['master', 'license', 'sound recording'],
  'sync-license': ['sync', 'film', 'tv', 'television', 'ad', 'commercial', 'game', 'video'],
  'publishing-agreement': ['publishing', 'publisher', 'composition', 'writer share', 'admin'],
  'distribution-agreement': ['distribution', 'distributor', 'release', 'platforms', 'spotify'],
  'booking-performance-agreement': ['booking', 'performance', 'show', 'gig', 'live', 'event', 'dj'],
};

// ── Generic fallback questions (used when both backend and AI are unavailable) ─
function genericFallbackQuestions(): TemplateQuestion[] {
  return [
    { id: 'partyOneName', label: 'Your Name / Company', type: 'text', placeholder: 'Your legal name', required: true },
    { id: 'partyOneRole', label: 'Your Role', type: 'text', placeholder: 'e.g., Artist, Producer', required: true },
    { id: 'partyTwoName', label: 'Other Party Name / Company', type: 'text', placeholder: 'Their legal name', required: true },
    { id: 'partyTwoRole', label: 'Other Party Role', type: 'text', placeholder: 'e.g., Manager, Label', required: true },
    { id: 'projectTitle', label: 'Project / Song Title', type: 'text', placeholder: 'e.g., My Song', required: true },
    { id: 'compensation', label: 'Compensation / Fee', type: 'text', placeholder: 'e.g., $500 upfront + 5% royalty', required: false },
    { id: 'royaltyPercentage', label: 'Royalty Percentage', type: 'number', placeholder: 'e.g., 5', required: false },
    { id: 'ownershipTerms', label: 'Ownership Terms', type: 'textarea', placeholder: 'Describe who owns what', required: false },
    { id: 'term', label: 'Duration / Term', type: 'text', placeholder: 'e.g., 2 years', required: false },
    { id: 'territory', label: 'Territory', type: 'text', placeholder: 'e.g., Worldwide', required: false },
    { id: 'notes', label: 'Additional Terms / Notes', type: 'textarea', placeholder: 'Any other details', required: false },
  ];
}

// ── Auth headers ──────────────────────────────────────────────────────────────
async function authHeaders() {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (import.meta.env.DEV && window.localStorage.getItem(DEMO_USER_KEY) === 'true') {
    headers['X-Own-Masters-Demo'] = 'true';
    return headers;
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// ── Backend helpers ───────────────────────────────────────────────────────────
async function postJson<T>(path: string, body: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = 'The Own Masters AI service is unavailable right now.';
    try {
      const payload = await response.json() as { error?: string };
      message = payload.error || message;
    } catch { /* keep generic message */ }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function getJson<T>(path: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: await authHeaders(),
  });

  if (!response.ok) {
    let message = 'The Own Masters API is unavailable right now.';
    try {
      const payload = await response.json() as { error?: string };
      message = payload.error || message;
    } catch { /* keep generic message */ }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function postBlob(path: string, body: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = 'The source file is unavailable right now.';
    try {
      const payload = await response.json() as { error?: string };
      message = payload.error || message;
    } catch { /* keep generic message */ }
    throw new Error(message);
  }

  return {
    blob: await response.blob(),
    contentType: response.headers.get('Content-Type') ?? 'application/octet-stream',
    disposition: response.headers.get('Content-Disposition') ?? '',
  };
}

// ── Direct Anthropic API call (same pattern as ContractFill artifact) ─────────
async function callAI(system: string, userMessage: string): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (ANTHROPIC_API_KEY) {
    headers['x-api-key'] = ANTHROPIC_API_KEY;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json() as {
    type?: string;
    error?: { message?: string };
    content?: Array<{ text?: string }>;
  };

  if (data.type === 'error') throw new Error(data.error?.message || 'AI API error');

  const raw = (data.content || []).map(b => b.text || '').join('').trim();
  if (!raw) throw new Error('Empty response from AI');
  return raw;
}

// Safely pull a JSON object out of an AI response (handles code-fenced or plain)
function extractJSON<T>(raw: string): T {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in AI response');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

// ── Field-extraction system prompt (same approach as ContractFill artifact) ───
const FIELD_EXTRACTION_SYSTEM = `You are a music contract analyst. Identify ALL blank fields (3+ underscores like ___) in a contract template.

Return ONLY valid JSON — no markdown, no explanation:
{
  "contractTitle": "Short descriptive title",
  "fields": [
    {
      "id": "unique_snake_case_id",
      "label": "Human Readable Label",
      "type": "text",
      "placeholder": "example value"
    }
  ]
}

FIELD TYPE OPTIONS (set "type" to exactly one of these strings):
- "text"     — default single-line input
- "date"     — any date field
- "number"   — dollar amounts or percentages
- "textarea" — multi-line descriptions or long terms
- "list"     — for fields that accept MULTIPLE values on separate lines.
               Use whenever the label contains "(S)" or clearly implies multiple people/items.
               e.g. "NAME OF MUSICIAN(S)", "CONTRIBUTOR(S)", "SONGWRITER(S)".
               Set "placeholder" to a single example entry like "e.g. John Smith".
- "count"    — for "Number of X" fields that control how many rows a linked list shows.
               MUST also include "controls": "<exact id of the linked list field>".
               e.g. "NUMBER OF MUSICIAN(S)" → type "count", "controls": "musician_names"

RULES:
1. One field per blank (___) in ORDER top to bottom
2. Every "id" must be globally unique — never reuse, even for similar blanks
3. Context-specific labels: "Employer Signature" vs "Musician Signature", not just "Signature" twice
4. ALWAYS pair list/count: when you see "Number of X" near "Name(s) of X", use count + list
5. Only include "controls" on count-type fields, nowhere else
6. Return ONLY the JSON object`;

async function analyzeTemplateText(templateText: string): Promise<{
  contractTitle: string;
  fields: TemplateQuestion[];
}> {
  const raw = await callAI(
    FIELD_EXTRACTION_SYSTEM,
    `Analyze this contract template. Return one field per blank (___), in order:\n\n${templateText.substring(0, 5000)}`,
  );

  const parsed = extractJSON<{ contractTitle: string; fields: TemplateQuestion[] }>(raw);

  if (!Array.isArray(parsed.fields) || parsed.fields.length === 0) {
    throw new Error('No blank fields detected in this template.');
  }

  return parsed;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function missingInfoFor(userRequest: string) {
  const req = userRequest.toLowerCase();
  const missing: string[] = [];
  if (!req.includes('artist') && !req.includes('producer') && !req.includes('manager')) missing.push('party names');
  if (!req.includes('song') && !req.includes('track') && !req.includes('single') && !req.includes('beat')) missing.push('song title');
  if (!/\d+\s*%/.test(userRequest) && !req.includes('percent')) missing.push('royalty percentage or payment amount');
  if (!req.includes('own') && !req.includes('master') && !req.includes('publishing')) missing.push('ownership terms');
  return missing.length ? missing : ['party names', 'song title', 'payment terms', 'ownership terms'];
}

// ── Public API ────────────────────────────────────────────────────────────────

export function recommendContractTemplateRuleBased(userRequest: string): ContractRecommendation {
  const req = userRequest.toLowerCase();
  const scored = CONTRACT_TEMPLATE_OPTIONS.map(template => ({
    template,
    score: (keywordMap[template.id] ?? []).reduce((t, kw) => req.includes(kw) ? t + 1 : t, 0),
  })).sort((a, b) => b.score - a.score);

  const winner = scored[0]?.score ? scored[0].template : CONTRACT_TEMPLATE_OPTIONS[0];

  return {
    source: 'rule_based',
    recommendedTemplateId: winner.id,
    recommendedContractType: winner.title,
    confidence: scored[0]?.score > 1 ? 0.72 : 0.52,
    reason: `Own Masters matched the request to ${winner.title} using the approved template catalog.`,
    alternatives: scored
      .filter(({ template }) => template.id !== winner.id)
      .slice(0, 3)
      .map(({ template }) => ({
        templateId: template.id,
        title: template.title,
        description: template.description,
        reason: template.description,
      })),
    missingInfo: missingInfoFor(userRequest),
  };
}

export async function recommendContractTemplate(userRequest: string): Promise<ContractRecommendation> {
  // 1. Try backend
  try {
    return await postJson<ContractRecommendation>('/api/contracts/recommend-ai', { userRequest });
  } catch { /* fall through */ }

  // 2. Direct AI
  try {
    const raw = await callAI(
      `You are a music contract expert. Recommend the most suitable contract type for the user's request.
Return ONLY valid JSON:
{
  "recommendedTemplateId": "one of the template IDs listed below",
  "recommendedContractType": "Human-readable contract name",
  "confidence": 0.85,
  "reason": "One sentence explanation",
  "alternatives": [
    { "templateId": "id", "title": "Name", "description": "desc", "reason": "why alternative" }
  ],
  "missingInfo": ["missing item 1", "missing item 2"]
}
Available template IDs: ${CONTRACT_TEMPLATE_OPTIONS.map(t => `${t.id} (${t.title})`).join(', ')}`,
      `User request: "${userRequest}"`,
    );
    const parsed = extractJSON<ContractRecommendation>(raw);
    return { ...parsed, source: 'openai' };
  } catch { /* fall through */ }

  // 3. Rule-based
  return recommendContractTemplateRuleBased(userRequest);
}

export async function explainContractClause(
  contractId: string,
  clauseText: string,
  contractType: string,
): Promise<ClauseExplanation> {
  // 1. Try backend
  try {
    return await postJson<ClauseExplanation>(`/api/contracts/${contractId}/explain-clause`, {
      clauseText,
      contractType,
    });
  } catch { /* fall through */ }

  // 2. Direct AI
  try {
    const raw = await callAI(
      `You are a plain-English music contract explainer. Explain contract clauses clearly for artists and producers.
Return ONLY valid JSON:
{
  "plainEnglishExplanation": "Clear explanation of what this clause means",
  "termsToReview": ["term1", "term2"],
  "riskLevel": "low|medium|high",
  "notLegalAdvice": true
}`,
      `Contract type: ${contractType}\n\nClause:\n"${clauseText}"`,
    );
    const parsed = extractJSON<ClauseExplanation>(raw);
    return { ...parsed, source: 'openai', notLegalAdvice: true };
  } catch { /* fall through */ }

  // 3. Static fallback
  return {
    source: 'rule_based',
    plainEnglishExplanation:
      'AI explanation is unavailable right now, but your contract draft is still saved. Review payment, ownership, duration, and defined terms carefully.',
    termsToReview: ['payment terms', 'ownership', 'duration'],
    riskLevel: 'medium',
    notLegalAdvice: true,
  } satisfies ClauseExplanation;
}

export async function reviewContractRisk(
  contractId: string,
  contractText: string,
  contractType: string,
): Promise<RiskReviewResult> {
  // 1. Try backend
  try {
    return await postJson<RiskReviewResult>(`/api/contracts/${contractId}/review-risk-ai`, {
      contractText,
      contractType,
    });
  } catch { /* fall through */ }

  // 2. Direct AI
  try {
    const raw = await callAI(
      `You are a music contract risk reviewer. Identify risks clearly for artists and producers.
Return ONLY valid JSON:
{
  "riskFlags": [
    {
      "id": "unique-flag-id",
      "severity": "low|medium|high",
      "title": "Short flag title",
      "explanation": "What the risk means in plain English",
      "suggestedQuestion": "Question to ask a lawyer or the other party"
    }
  ],
  "summary": "One-paragraph plain-English summary of overall risk level",
  "notLegalAdvice": true
}`,
      `Contract type: ${contractType}\n\nContract text (first 3000 chars):\n${contractText.substring(0, 3000)}`,
    );
    const parsed = extractJSON<RiskReviewResult>(raw);
    return { ...parsed, source: 'openai', notLegalAdvice: true };
  } catch { /* fall through */ }

  // 3. Static fallback
  return {
    source: 'rule_based',
    riskFlags:
      contractText.includes('[TO BE COMPLETED]') || /_{8,}/.test(contractText)
        ? [
            {
              id: 'missing-completion-markers',
              severity: 'medium',
              title: 'Incomplete terms remain',
              explanation:
                'Some material terms still need to be completed before anyone relies on this draft.',
              suggestedQuestion:
                'Which missing details should be confirmed before sharing this draft?',
            },
          ]
        : [],
    summary:
      'AI risk review is unavailable right now. Local review completed with the available draft text.',
    notLegalAdvice: true,
  } satisfies RiskReviewResult;
}

export async function getTemplateQuestions(templateId: string) {
  // Return cached result if available (avoids redundant AI calls)
  const cached = templateAnalysisCache.get(templateId);
  if (cached) {
    const template = CONTRACT_TEMPLATE_OPTIONS.find(t => t.id === templateId);
    return {
      template: template ?? { id: templateId, title: templateId, description: '' } as ContractTemplateOption,
      questions: cached.questions,
      schema: {
        version: '1.0',
        source: 'ai_analysis',
        template_id: templateId,
        template_name: template?.title,
      },
    };
  }

  // 1. Try backend
  try {
    const result = await postJson<{
      template: ContractTemplateOption;
      questions: TemplateQuestion[];
      schema?: unknown;
    }>('/api/contracts/template-questions', { templateId });

    if (result.questions?.length) {
      templateAnalysisCache.set(templateId, {
        questions: result.questions,
        templateText: BUILT_IN_TEMPLATES[templateId] ?? '',
      });
      return result;
    }
  } catch { /* fall through */ }

  // 2. Get template text: try backend preview, fall back to built-in
  let templateText = BUILT_IN_TEMPLATES[templateId] ?? '';
  try {
    const preview = await fetchTemplatePreview(templateId);
    if (preview.templateText) templateText = preview.templateText;
  } catch { /* use built-in */ }

  // 3. Use AI to analyze template and extract fields
  if (templateText) {
    try {
      const { contractTitle, fields } = await analyzeTemplateText(templateText);
      const template = CONTRACT_TEMPLATE_OPTIONS.find(t => t.id === templateId);
      const questions = fields.map(f => ({ ...f, required: f.required ?? true }));

      templateAnalysisCache.set(templateId, { questions, templateText });

      return {
        template: template ?? { id: templateId, title: contractTitle, description: '' } as ContractTemplateOption,
        questions,
        schema: {
          version: '1.0',
          source: 'ai_analysis',
          template_id: templateId,
          template_name: contractTitle,
        },
      };
    } catch { /* fall through */ }
  }

  // 4. Generic fallback questions (always works)
  const template = CONTRACT_TEMPLATE_OPTIONS.find(t => t.id === templateId);
  const questions = genericFallbackQuestions();

  templateAnalysisCache.set(templateId, {
    questions,
    templateText: templateText ?? '',
  });

  return {
    template: template ?? { id: templateId, title: templateId, description: '' } as ContractTemplateOption,
    questions,
    schema: {
      version: '1.0',
      source: 'fallback',
      template_id: templateId,
      template_name: template?.title,
    },
  };
}

export async function fetchContractTemplates() {
  try {
    const result = await postJson<{ templates: ContractTemplateOption[] }>('/api/contracts/templates', {});
    return result.templates.length ? result.templates : CONTRACT_TEMPLATE_OPTIONS;
  } catch {
    return CONTRACT_TEMPLATE_OPTIONS;
  }
}

export async function renderTemplateDraft(
  templateId: string,
  answers: ContractWizardAnswers,
  userRequest: string,
) {
  // 1. Try backend
  try {
    const result = await postJson<{
      status?: 'ready' | 'ready_with_blank_placeholders';
      missing_inputs?: Array<{ field: string; label: string; placeholder: string }>;
      content: string;
    }>('/api/contracts/render-template', { templateId, answers, userRequest });

    if (result.content?.trim()) return result.content;
  } catch { /* fall through */ }

  // 2. Client-side fill using template text + field order from cache
  //    Run getTemplateQuestions first if we have no cache yet
  let cached = templateAnalysisCache.get(templateId);
  if (!cached) {
    try {
      await getTemplateQuestions(templateId); // populates cache as a side-effect
      cached = templateAnalysisCache.get(templateId);
    } catch { /* fall through */ }
  }

  if (cached?.templateText && cached.questions.length) {
    const fieldIds = cached.questions.map(q => q.id as string);
    return fillTemplateWithAnswers(cached.templateText, fieldIds, answers);
  }

  // 3. Last resort: deterministic draft
  const template = CONTRACT_TEMPLATE_OPTIONS.find(t => t.id === templateId);
  return generateDeterministicContractDraft(template?.title ?? templateId, answers, userRequest);
}

export async function fetchTemplateSourceFile(templateId: string) {
  return await postBlob('/api/contracts/template-file', { templateId });
}

export async function fetchTemplatePreview(templateId: string) {
  return await postJson<{
    id: string;
    title: string;
    sourceFile: string;
    extension: string;
    extractionQuality: string;
    templateText: string;
  }>('/api/contracts/template-preview', { templateId });
}

export async function fetchLocalContractTemplates(options?: { includeAll?: boolean }) {
  const query = options?.includeAll ? '?includeAll=true' : '';
  const result = await getJson<{ templates: LocalContractTemplate[] }>(`/api/contracts/templates${query}`);
  return result.templates;
}

export async function fetchLocalContractTemplate(templateId: string) {
  const result = await getJson<{ template: LocalContractTemplate }>(`/api/contracts/templates/${templateId}`);
  return result.template;
}

export async function importLocalContractZip(zipPath?: string) {
  return await postJson<{
    summary: {
      totalEntries: number;
      importedCount: number;
      skippedCount: number;
      errors: Array<{ entry: string; error: string }>;
      imported: Array<{ id: string; name: string }>;
    };
  }>('/api/contracts/import-zip', zipPath ? { zipPath } : {});
}

export async function scanLocalContractTemplate(templateId: string) {
  const result = await postJson<{ template: LocalContractTemplate }>(`/api/contracts/templates/${templateId}/scan`, {});
  return result.template;
}

export async function approveLocalContractTemplate(templateId: string) {
  const result = await postJson<{ template: LocalContractTemplate }>(`/api/contracts/templates/${templateId}/approve`, {});
  return result.template;
}

export async function scanAllLocalContractTemplates(force = false) {
  return await postJson<{
    results: Array<{ id: string; name: string; status: string; error?: string }>;
  }>('/api/contracts/templates/scan-all', { force });
}

export async function fetchLocalTemplateSchema(templateId: string) {
  return await getJson<{
    fieldSchema: LocalContractFieldSchema | null;
    warnings: Array<{ type: string; message: string; context?: string }> | null;
    status: string;
    approved: boolean;
  }>(`/api/contracts/templates/${templateId}/schema`);
}

export async function fillLocalContractTemplate(templateId: string, dealData: Record<string, string>, title?: string) {
  return await postJson<{
    generatedContractId: string;
    downloadUrl: string;
    warnings: Array<{ type: string; message: string }>;
    missingRequiredFields: Array<{ key: string; label: string }>;
  }>(`/api/contracts/templates/${templateId}/fill`, { dealData, title });
}

export function localGeneratedContractDownloadUrl(path: string) {
  return `${API_BASE}${path}`;
}
