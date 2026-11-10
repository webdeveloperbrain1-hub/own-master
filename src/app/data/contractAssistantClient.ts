/// <reference types="vite/client" />
import { API_BASE, apiHeaders } from './apiClient';
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
async function authHeaders() { return { 'Content-Type': 'application/json', ...(await apiHeaders()) }; }

// ── Backend helpers ───────────────────────────────────────────────────────────
async function postJson<T>(path: string, body: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
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
    credentials: 'include',
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
    credentials: 'include',
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
