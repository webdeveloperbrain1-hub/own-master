import { config } from "./filingConfig.mjs";
import { fallbackAnalyze } from "./fallbackAnalyzer.mjs";

const MAX_ANALYSIS_CHARS = 18000;

export async function analyzeContract(input) {
  if (process.env.AI_FEATURES_ENABLED !== 'true')
    return fallbackAnalyze({ ...input, reason: 'Template imported for manual review and editing. AI assistance is disabled.' });
  if (config.aiProvider !== "ollama") {
    return fallbackAnalyze({
      ...input,
      reason: 'Automated filing analysis is unavailable for the configured provider. Review the template before use.'
    });
  }

  const messages = buildMessages(input, false);
  const first = await requestOllamaJson(messages);
  if (first.ok) return normalizeAnalysis(first.data, config.ollamaModel);

  const retry = await requestOllamaJson(buildMessages(input, true));
  if (retry.ok) return normalizeAnalysis(retry.data, config.ollamaModel);

  return fallbackAnalyze({
    ...input,
    reason: `Ollama JSON analysis failed after retry: ${retry.error || first.error}`
  });
}

function buildMessages({ originalName, text }, strictRetry) {
  const clipped = (text || "").slice(0, MAX_ANALYSIS_CHARS);
  const strictness = strictRetry
    ? "Return only parseable JSON. No markdown, comments, prose, or trailing commas."
    : "Return JSON only.";

  return [
    {
      role: "system",
      content:
        "You are a precise contract filing analyst for music industry agreements. Extract only facts supported by the contract text. Use null for unknown dates or terms. Flag uncertainty instead of guessing."
    },
    {
      role: "user",
      content: `${strictness}

Analyze this contract for filing accuracy.

Required JSON schema:
{
  "title": "string",
  "contractType": "string",
  "category": "string",
  "parties": [{"name":"string","role":"string","confidence":0.0}],
  "effectiveDate": "YYYY-MM-DD or null",
  "expirationDate": "YYYY-MM-DD or null",
  "summary": "2-4 sentences",
  "keyTerms": [{"term":"string","detail":"string"}],
  "obligations": [{"party":"string","obligation":"string"}],
  "rights": [{"holder":"string","right":"string"}],
  "paymentTerms": "string or null",
  "territory": "string or null",
  "duration": "string or null",
  "governingLaw": "string or null",
  "renewalTerms": "string or null",
  "terminationTerms": "string or null",
  "riskFlags": ["string"],
  "tags": ["string"],
  "confidence": 0.0,
  "needsReview": true
}

Rules:
- needsReview must be true if text extraction looks incomplete, parties are unclear, dates conflict, or confidence is below 0.75.
- Confidence must reflect evidence quality, not optimism.
- Do not invent party names, dates, territories, or payment terms.

File name: ${originalName}

Contract text:
${clipped}`
    }
  ];
}

async function requestOllamaJson(messages) {
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        messages,
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_ctx: 16384, num_predict: 1800 }
      })
    });

    if (!response.ok) {
      return { ok: false, error: `Ollama HTTP ${response.status}` };
    }

    const data = await response.json();
    const content = data?.message?.content;
    if (!content) return { ok: false, error: "Ollama returned no message content" };

    return { ok: true, data: JSON.parse(content) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function normalizeAnalysis(raw, model) {
  const confidence = clampNumber(raw.confidence, 0, 1, 0.4);
  const needsReview = Boolean(raw.needsReview || confidence < 0.75);

  return {
    analysisStatus: needsReview ? "needs_review" : "complete",
    needsReview,
    reviewReason: needsReview ? "AI marked this filing for human review" : null,
    title: stringOrNull(raw.title),
    contractType: stringOrNull(raw.contractType),
    category: stringOrNull(raw.category) || stringOrNull(raw.contractType),
    parties: Array.isArray(raw.parties) ? raw.parties : [],
    effectiveDate: stringOrNull(raw.effectiveDate),
    expirationDate: stringOrNull(raw.expirationDate),
    summary: stringOrNull(raw.summary),
    keyTerms: Array.isArray(raw.keyTerms) ? raw.keyTerms : [],
    obligations: Array.isArray(raw.obligations) ? raw.obligations : [],
    rights: Array.isArray(raw.rights) ? raw.rights : [],
    paymentTerms: stringOrNull(raw.paymentTerms),
    territory: stringOrNull(raw.territory),
    duration: stringOrNull(raw.duration),
    governingLaw: stringOrNull(raw.governingLaw),
    renewalTerms: stringOrNull(raw.renewalTerms),
    terminationTerms: stringOrNull(raw.terminationTerms),
    riskFlags: Array.isArray(raw.riskFlags) ? raw.riskFlags : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean).map(String).slice(0, 12) : [],
    confidence,
    analyzerModel: model
  };
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text.toLowerCase() !== "null" ? text : null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
