import { loadEnv } from '../env.mjs';

loadEnv();

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_PROVIDER = 'openai';
const OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/api/chat';
let warnedMissingKey = false;
let warnedMissingOllamaModel = false;
let warnedUnknownProvider = false;

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function aiProvider() {
  const provider = String(process.env.AI_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();

  if (provider === 'openai' || provider === 'ollama') {
    return provider;
  }

  if (!warnedUnknownProvider) {
    warnedUnknownProvider = true;
    console.warn(`[own-masters-api] Unsupported AI_PROVIDER="${provider}". Falling back to openai.`);
  }

  return DEFAULT_PROVIDER;
}

function parseJsonContent(content) {
  if (!content) {
    return { json: null, invalidJson: false };
  }

  if (typeof content === 'object') {
    return { json: content, invalidJson: false };
  }

  const text = String(content).trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : text;

  try {
    return { json: JSON.parse(candidate), invalidJson: false };
  } catch {
    return { json: null, invalidJson: true };
  }
}

function strictJsonRetryMessages(messages) {
  return [
    {
      role: 'system',
      content: 'You extract contract form fields and return strict JSON only. Return one valid JSON object with no markdown, prose, comments, or trailing commas.',
    },
    ...messages.filter((message) => message.role !== 'system'),
    {
      role: 'user',
      content: 'Your previous response was invalid JSON. Retry the same task and return only one syntactically valid JSON object.',
    },
  ];
}

async function requestOpenAIChatJson({ messages, maxTokens }) {
  loadEnv();

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn('[own-masters-api] OPENAI_API_KEY is missing. AI calls will use safe fallbacks.');
    }

    return { json: null, error: { type: 'missing_config', message: 'OPENAI_API_KEY is missing.' } };
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.warn(`[own-masters-api] OpenAI request failed with ${response.status}: ${body.slice(0, 240)}`);
    return { json: null, error: { type: 'http_error', message: `OpenAI request failed with ${response.status}.` } };
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  const parsed = parseJsonContent(content);

  if (parsed.invalidJson) {
    console.warn('[own-masters-api] OpenAI returned invalid JSON.');
    return { json: null, error: { type: 'invalid_json', message: 'OpenAI returned invalid JSON.' } };
  }

  return { json: parsed.json, error: null };
}

async function requestOllamaChatJson({ messages, maxTokens = 900 }) {
  loadEnv();

  const model = process.env.OLLAMA_MODEL;

  if (!model) {
    if (!warnedMissingOllamaModel) {
      warnedMissingOllamaModel = true;
      console.warn('[own-masters-api] OLLAMA_MODEL is missing. AI calls will use safe fallbacks.');
    }

    return { json: null, error: { type: 'missing_config', message: 'OLLAMA_MODEL is missing.' } };
  }

  let response;

  try {
    response = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: 'json',
        // Structured echo-back task: keep sampling tight so the model faithfully
        // returns the parser's candidateIds instead of hallucinating new ones.
        // num_ctx must hold the full prompt (contract text + up to 100 candidates,
        // ~5k tokens) PLUS the JSON output (num_predict); 8192 overflowed and
        // truncated the answer, which made the model drop/invent candidateIds.
        options: {
          temperature: 0.1,
          top_p: 0.9,
          repeat_penalty: 1.05,
          num_ctx: 16384,
          num_predict: maxTokens,
        },
      }),
    });
  } catch (error) {
    console.warn(`[own-masters-api] Ollama request failed: ${error.message}`);
    return { json: null, error: { type: 'request_error', message: error.message } };
  }

  if (!response.ok) {
    const body = await response.text();
    console.warn(`[own-masters-api] Ollama request failed with ${response.status}: ${body.slice(0, 240)}`);
    return { json: null, error: { type: 'http_error', message: `Ollama request failed with ${response.status}.` } };
  }

  const data = await response.json();
  const parsed = parseJsonContent(data?.message?.content);

  if (parsed.invalidJson) {
    console.warn('[own-masters-api] Ollama returned invalid JSON.');
    return { json: null, error: { type: 'invalid_json', message: 'Ollama returned invalid JSON.' } };
  }

  return { json: parsed.json, error: null };
}

async function requestProviderJson({ provider, messages, maxTokens }) {
  if (provider === 'ollama') {
    return await requestOllamaChatJson({ messages, maxTokens });
  }

  return await requestOpenAIChatJson({ messages, maxTokens });
}

export async function requestAIJsonResult({ messages, maxTokens = 900, retryInvalidJson = false }) {
  loadEnv();

  const provider = aiProvider();
  const first = await requestProviderJson({ provider, messages, maxTokens });

  if (first.json || first.error?.type !== 'invalid_json' || !retryInvalidJson) {
    return { provider, ...first };
  }

  const retry = await requestProviderJson({
    provider,
    messages: strictJsonRetryMessages(messages),
    maxTokens,
  });

  return {
    provider,
    ...retry,
    error: retry.error ?? null,
    retried: true,
  };
}

export async function requestOpenAIJson({ messages, maxTokens = 900 }) {
  const result = await requestAIJsonResult({ messages, maxTokens });
  return result.json;
}
