/// <reference types="vite/client" />

import { apiFetch, apiJson, downloadApiFile } from './apiClient';

export async function uploadFilingTemplate(file: File): Promise<{ id: string; originalName: string; duplicate: boolean; needsReview: boolean }> {
  const response = await apiFetch(`/api/filing/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  });
  return response.json();
}

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
  kind: 'template' | 'guide';
  description: string;
  commonType: boolean;
  extractionLabel: string;
  analysisLabel: string;
  hiddenDuplicate: boolean;
  duplicateOf: string | null;
  duplicateCount: number;
  duplicateReason?: string;
  variant: string | null;
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
  renderedText: string;
  documentHtml: string;
  documentLayout: FilingDocumentLayout;
}

export interface FilingDocumentLayout {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  pageCount: number;
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
  template: { originalName: string; title: string | null; contractType: string | null; category: string | null };
}

export interface FilingDraft extends FilingDraftListItem {
  values: Record<string, string>;
  renderedText: string;
}

export interface FilingSummary {
  total: number;
  templates: number;
  guides: number;
  hiddenDuplicates: number;
  needsReview: number;
  complete: number;
  failedExtraction: number;
  categories: { category: string | null; _count: { _all: number } }[];
}

async function getJson<T>(path: string): Promise<T> {
  return apiJson<T>(path);
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return apiJson<T>(path, body ?? {});
}

export function fetchFilingSummary() {
  return getJson<FilingSummary>('/api/filing/summary');
}

export interface FilingGuide {
  id: string;
  title: string;
  originalName: string;
  description: string;
  format: string;
  text: string;
  readOnly: true;
}

export function fetchFilingGuide(id: string) {
  return getJson<FilingGuide>(`/api/filing/guides/${encodeURIComponent(id)}`);
}

export function fetchFilingTemplates(query = '', options: { kind?: 'template' | 'guide'; category?: string; includeDuplicates?: boolean; commonOnly?: boolean } = {}) {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (options.kind) params.set('kind', options.kind);
  if (options.category) params.set('category', options.category);
  if (options.includeDuplicates) params.set('includeDuplicates', 'true');
  if (options.commonOnly) params.set('commonOnly', 'true');
  return getJson<FilingTemplateListItem[]>(`/api/filing/templates?${params}`);
}

export function fetchFilingTemplateFill(id: string) {
  return getJson<FilingFillResponse>(`/api/filing/templates/${id}/fill`);
}

export function previewFilingTemplate(id: string, values: Record<string, string>) {
  return postJson<FilingPreviewResponse>(`/api/filing/templates/${id}/preview`, { values });
}

export function saveFilingDraft(id: string, name: string, renderedText: string, documentHtml: string, projectId?: string) {
  return postJson<{ draft: { id: string; name: string; status: string; updatedAt: string }; completion: FilingCompletion | null }>(
    `/api/filing/templates/${id}/drafts`,
    { name, renderedText, documentHtml, projectId },
  );
}

export function fetchFilingDrafts() {
  return getJson<FilingDraftListItem[]>('/api/filing/drafts');
}

export function fetchFilingDraft(id: string) {
  return getJson<FilingDraft>(`/api/filing/drafts/${encodeURIComponent(id)}`);
}

export function updateFilingDraft(id: string, name: string, renderedText: string, documentHtml: string, projectId?: string) {
  return postJson<{ draft: { id: string; name: string; status: string; updatedAt: string }; completion: FilingCompletion | null }>(
    `/api/filing/drafts/${id}/update`,
    { name, renderedText, documentHtml, projectId },
  );
}

export function deleteFilingDraft(id: string) {
  return postJson<{ ok: boolean }>(`/api/filing/drafts/${id}/delete`);
}

export function scanAllFilingFields(force = false) {
  return postJson<{ scanned: number; total: number }>(`/api/filing/scan-all${force ? '?force=true' : ''}`);
}

export function downloadFilingDraft(draftId: string, format: 'pdf' | 'docx' = 'pdf') {
  return downloadApiFile(`/api/filing/drafts/${encodeURIComponent(draftId)}/download?format=${format}`, `contract.${format}`);
}

export function downloadFilingOriginal(templateId: string) {
  return downloadApiFile(`/api/filing/templates/${encodeURIComponent(templateId)}/original`, 'original-template.pdf');
}
