/// <reference types="vite/client" />

// Client for the Contract Filing engine (/api/filing/*). These endpoints are
// local-first and unauthenticated, so this client stays decoupled from Supabase.

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787';

export type FilingFieldType = 'text' | 'textarea' | 'paragraph' | 'date' | 'money' | 'percent';

export interface FilingField {
  key: string;
  label: string;
  type: FilingFieldType;
  required?: boolean;
  hidden?: boolean;
  helpText?: string;
  source?: string;
}

export interface FilingTemplateListItem {
  id: string;
  originalName: string;
  title: string;
  contractType: string | null;
  category: string | null;
  summary: string | null;
  textLength: number;
  draftCount: number;
}

export interface FilingTemplateMeta {
  id: string;
  originalName: string;
  title: string;
  contractType: string | null;
  category: string | null;
  summary: string | null;
}

export interface FilingFillResponse {
  template: FilingTemplateMeta;
  fields: FilingField[];
  preview: string;
}

export interface FilingCompletion {
  totalFields: number;
  requiredFields: number;
  filledRequired: number;
  filledFields: number;
  missingRequired: string[];
}

export interface FilingPreviewResponse {
  renderedText: string;
  renderedHtml: string;
  completion: FilingCompletion;
}

export interface FilingDraftListItem {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  templateId: string;
  values: Record<string, string>;
  template: { originalName: string; title: string | null; contractType: string | null; category: string | null };
}

export interface FilingSummary {
  total: number;
  needsReview: number;
  complete: number;
  failedExtraction: number;
  categories: { category: string | null; _count: { _all: number } }[];
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error((await safeError(response)) || `Request failed (${response.status})`);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await safeError(response)) || `Request failed (${response.status})`);
  return (await response.json()) as T;
}

async function safeError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || '';
  } catch {
    return '';
  }
}

export function fetchFilingSummary() {
  return getJson<FilingSummary>('/api/filing/summary');
}

export function fetchFilingTemplates(query = '') {
  const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  return getJson<FilingTemplateListItem[]>(`/api/filing/templates${params}`);
}

export function fetchFilingTemplateFill(id: string) {
  return getJson<FilingFillResponse>(`/api/filing/templates/${id}/fill`);
}

export function previewFilingTemplate(id: string, values: Record<string, string>) {
  return postJson<FilingPreviewResponse>(`/api/filing/templates/${id}/preview`, { values });
}

export function saveFilingDraft(id: string, name: string, values: Record<string, string>) {
  return postJson<{ draft: { id: string; name: string; status: string }; completion: FilingCompletion }>(
    `/api/filing/templates/${id}/drafts`,
    { name, values },
  );
}

export function fetchFilingDrafts() {
  return getJson<FilingDraftListItem[]>('/api/filing/drafts');
}

export function updateFilingDraft(id: string, name: string, values: Record<string, string>) {
  return postJson<{ draft: { id: string; name: string; status: string }; completion: FilingCompletion }>(
    `/api/filing/drafts/${id}/update`,
    { name, values },
  );
}

export function deleteFilingDraft(id: string) {
  return postJson<{ ok: boolean }>(`/api/filing/drafts/${id}/delete`);
}

export function importFilingLibrary(limit = 0) {
  const params = limit ? `?limit=${limit}` : '';
  return postJson<{ discovered: number; imported: number; duplicates: number; failed: number }>(
    `/api/filing/import${params}`,
  );
}

export function scanAllFilingFields(force = false) {
  return postJson<{ scanned: number; total: number }>(`/api/filing/scan-all${force ? '?force=true' : ''}`);
}

export function filingDraftDownloadUrl(draftId: string, format: 'docx' | 'pdf') {
  return `${API_BASE}/api/filing/drafts/${draftId}/download?format=${format}`;
}
