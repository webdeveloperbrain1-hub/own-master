import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileText,
  FolderDown,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  deleteFilingDraft,
  fetchFilingDrafts,
  fetchFilingSummary,
  fetchFilingTemplateFill,
  fetchFilingTemplates,
  filingDraftDownloadUrl,
  importFilingLibrary,
  previewFilingTemplate,
  saveFilingDraft,
  scanAllFilingFields,
  updateFilingDraft,
  type FilingCompletion,
  type FilingDraftListItem,
  type FilingField,
  type FilingSummary,
  type FilingTemplateListItem,
  type FilingTemplateMeta,
} from '../data/contractFilingClient';

const primaryButton =
  'inline-flex items-center justify-center gap-2 border border-primary bg-primary text-primary-foreground px-[15px] py-[11px] rounded-[14px] font-[750] cursor-pointer hover:opacity-90 transition-all hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100';
const ghostButton =
  'inline-flex items-center justify-center gap-2 border border-border bg-muted text-foreground px-[14px] py-[10px] rounded-[14px] font-[700] cursor-pointer hover:bg-accent transition-all disabled:opacity-60 disabled:cursor-not-allowed';
const panel =
  'border border-border bg-gradient-to-b from-[rgba(255,255,255,.08)] to-[rgba(255,255,255,.04)] rounded-[22px]';
const inputClass =
  'w-full bg-[rgba(255,255,255,.04)] border border-border rounded-[12px] px-[12px] py-[9px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors';

function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), wait);
    },
    [fn, wait],
  );
}

export default function ContractFillerPage() {
  const [templates, setTemplates] = useState<FilingTemplateListItem[]>([]);
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<FilingSummary | null>(null);
  const [view, setView] = useState<'fill' | 'drafts'>('fill');
  const [drafts, setDrafts] = useState<FilingDraftListItem[]>([]);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<FilingTemplateMeta | null>(null);
  const [fields, setFields] = useState<FilingField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [draftName, setDraftName] = useState('');
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [completion, setCompletion] = useState<FilingCompletion | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const visibleFields = useMemo(() => fields.filter((field) => !field.hidden), [fields]);

  const loadTemplates = useCallback(async (q: string) => {
    try {
      setTemplates(await fetchFilingTemplates(q));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load templates.');
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await fetchFilingSummary());
    } catch {
      /* summary is non-critical */
    }
  }, []);

  useEffect(() => {
    void loadTemplates('');
    void loadSummary();
  }, [loadTemplates, loadSummary]);

  const debouncedSearch = useDebouncedCallback((q: string) => void loadTemplates(q), 250);

  const refreshPreview = useCallback(
    async (templateId: string, nextValues: Record<string, string>) => {
      try {
        const result = await previewFilingTemplate(templateId, nextValues);
        setPreviewHtml(result.renderedHtml);
        setCompletion(result.completion);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Preview failed.');
      }
    },
    [],
  );

  const debouncedPreview = useDebouncedCallback(
    (templateId: string, nextValues: Record<string, string>) => void refreshPreview(templateId, nextValues),
    250,
  );

  async function selectTemplate(id: string) {
    setLoadingTemplate(true);
    setView('fill');
    setSavedDraftId(null);
    setEditingDraftId(null);
    try {
      const data = await fetchFilingTemplateFill(id);
      setSelected(data.template);
      setFields(data.fields);
      setValues({});
      setDraftName(`${data.template.title} - draft`);
      setPreviewHtml(data.preview);
      await refreshPreview(id, {});
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to open template.');
    } finally {
      setLoadingTemplate(false);
    }
  }

  function updateValue(key: string, value: string) {
    const next = { ...values, [key]: value };
    setValues(next);
    setSavedDraftId(null);
    if (selected) debouncedPreview(selected.id, next);
  }

  async function handleSaveDraft() {
    if (!selected) return;
    setBusy(true);
    setStatus('');
    try {
      const result = editingDraftId
        ? await updateFilingDraft(editingDraftId, draftName, values)
        : await saveFilingDraft(selected.id, draftName, values);
      setSavedDraftId(result.draft.id);
      setEditingDraftId(result.draft.id);
      setCompletion(result.completion);
      const action = editingDraftId ? 'Draft updated' : 'Draft saved';
      setStatus(
        result.completion.missingRequired.length
          ? `${action}. Still missing: ${result.completion.missingRequired.join(', ')}.`
          : `${action} and ready to download.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save draft.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEditDraft(draft: FilingDraftListItem) {
    setLoadingTemplate(true);
    setView('fill');
    setSavedDraftId(null);
    setEditingDraftId(draft.id);
    try {
      const data = await fetchFilingTemplateFill(draft.templateId);
      const draftValues = draft.values || {};
      setSelected(data.template);
      setFields(data.fields);
      setValues(draftValues);
      setDraftName(draft.name);
      setPreviewHtml(data.preview);
      await refreshPreview(draft.templateId, draftValues);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to open draft.');
    } finally {
      setLoadingTemplate(false);
    }
  }

  async function handleDeleteDraft(draft: FilingDraftListItem) {
    if (!window.confirm(`Delete draft "${draft.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteFilingDraft(draft.id);
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      if (editingDraftId === draft.id) setEditingDraftId(null);
      setStatus('Draft deleted.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to delete draft.');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setStatus('Importing contract library (this can take a few minutes on first run)...');
    try {
      const result = await importFilingLibrary(0);
      setStatus(`Imported ${result.imported}, duplicates ${result.duplicates}, failed ${result.failed}.`);
      await loadTemplates(query);
      await loadSummary();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  async function runScanAll() {
    setBusy(true);
    setStatus('Scanning template fields with AI...');
    try {
      const result = await scanAllFilingFields(false);
      setStatus(`Scanned fields for ${result.scanned} template(s).`);
      await loadSummary();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Field scan failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openDrafts() {
    setView('drafts');
    try {
      setDrafts(await fetchFilingDrafts());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load drafts.');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <style>{`
        .filling-preview .filled-value { background: #c6f3d9; color: #14532d; padding: 0 3px; border-radius: 3px; font-weight: 700; }
        .filling-preview .placeholder { color: rgba(0,0,0,.32); }
      `}</style>

      {/* Header */}
      <header className={`${panel} p-5 flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <p className="text-[12px] uppercase tracking-[2px] text-muted-foreground flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" /> Contract Filler
          </p>
          <h1 className="text-[26px] font-[800] mt-1">Fill a contract template</h1>
          <p className="text-muted-foreground text-[14px] mt-1 max-w-[560px]">
            Pick a template, answer the fields, watch the live preview update, then save and download a filled draft.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className={ghostButton} onClick={runImport} disabled={busy}>
            <FolderDown className="w-4 h-4" /> Import library
          </button>
          <button className={ghostButton} onClick={runScanAll} disabled={busy}>
            <RefreshCw className="w-4 h-4" /> Scan fields
          </button>
          <button className={ghostButton} onClick={openDrafts} disabled={busy}>
            <FileText className="w-4 h-4" /> Saved drafts
          </button>
        </div>
      </header>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Templates" value={summary.total} />
          <Stat label="Needs review" value={summary.needsReview} />
          <Stat label="Analyzed" value={summary.complete} />
          <Stat label="Extraction issues" value={summary.failedExtraction} />
        </div>
      )}

      {status && (
        <div className={`${panel} px-4 py-3 text-[13px] text-muted-foreground flex items-center gap-2`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {status}
        </div>
      )}

      {/* Templates: horizontal strip across the top */}
      <section className={`${panel} p-4`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-[12px] uppercase tracking-[2px] text-muted-foreground">Templates</p>
          <div className="relative w-full max-w-[320px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className={`${inputClass} pl-9`}
              placeholder="Search templates..."
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                debouncedSearch(event.target.value);
              }}
            />
          </div>
        </div>
        {templates.length === 0 ? (
          <p className="text-muted-foreground text-[13px] py-6 text-center">
            No templates match your search.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-h-[200px] overflow-y-auto pr-1">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => selectTemplate(template.id)}
                className={`text-left border rounded-[16px] p-3 transition-colors ${
                  selected?.id === template.id
                    ? 'border-primary bg-accent'
                    : 'border-border bg-[rgba(255,255,255,.03)] hover:bg-accent'
                }`}
              >
                <p className="font-[700] text-[14px] leading-tight line-clamp-2 min-h-[34px]">{template.title}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Pill>{template.category || 'Template'}</Pill>
                  {template.draftCount > 0 && <Pill tone="good">{template.draftCount} drafts</Pill>}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Work area: Fill + Live Preview side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Fill form OR drafts */}
        {view === 'drafts' ? (
          <section className={`${panel} p-5 lg:col-span-2`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[18px] font-[750]">Saved drafts</h2>
              <button className={ghostButton} onClick={() => setView('fill')}>Back to filling</button>
            </div>
            {drafts.length === 0 ? (
              <p className="text-muted-foreground text-[14px]">No drafts saved yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {drafts.map((draft) => (
                  <article key={draft.id} className="border border-border rounded-[16px] p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-[700]">{draft.name}</p>
                      <p className="text-muted-foreground text-[13px]">{draft.template.title || draft.template.originalName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill tone={draft.status === 'ready' ? 'good' : 'muted'}>{draft.status}</Pill>
                      <button className={ghostButton} onClick={() => handleEditDraft(draft)} disabled={busy}>
                        <Pencil className="w-4 h-4" /> Edit
                      </button>
                      <DownloadButtons draftId={draft.id} />
                      <button
                        className={`${ghostButton} hover:!bg-red-500/15 hover:!border-red-400/50 hover:!text-red-200`}
                        onClick={() => handleDeleteDraft(draft)}
                        disabled={busy}
                      >
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : !selected ? (
          <section className={`${panel} p-8 lg:col-span-2 flex items-center justify-center`}>
            <p className="text-muted-foreground text-center">Select a contract template to start filling it.</p>
          </section>
        ) : (
          <>
            {/* Fill form */}
            <section className={`${panel} p-5 lg:max-h-[calc(100vh-300px)] lg:overflow-auto`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-[12px] uppercase tracking-[2px] text-muted-foreground">Fill template</p>
                  <h2 className="text-[18px] font-[750] leading-tight">{selected.title}</h2>
                </div>
                <Pill>{visibleFields.length} fields</Pill>
              </div>

              {completion && (
                <div className="mb-4 text-[13px] text-muted-foreground">
                  <span className="text-foreground font-[700]">{completion.filledFields}/{completion.totalFields}</span> fields filled
                  {completion.missingRequired.length > 0 && (
                    <span className="text-amber-300/80"> · missing required: {completion.missingRequired.join(', ')}</span>
                  )}
                </div>
              )}

              {loadingTemplate ? (
                <div className="py-10 flex justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : (
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-[650]">Draft name</span>
                    <input className={inputClass} value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                  </label>

                  {visibleFields.map((field) => (
                    <label key={field.key} className="flex flex-col gap-1.5">
                      <span className="text-[13px] font-[650] flex items-center gap-2">
                        {field.label}
                        {field.required && <span className="text-[10px] uppercase tracking-wide text-amber-300/80">Required</span>}
                      </span>
                      {field.type === 'textarea' || field.type === 'paragraph' ? (
                        <textarea
                          className={inputClass}
                          rows={field.type === 'paragraph' ? 5 : 3}
                          value={values[field.key] || ''}
                          onChange={(e) => updateValue(field.key, e.target.value)}
                        />
                      ) : (
                        <input
                          className={inputClass}
                          type={field.type === 'date' ? 'text' : 'text'}
                          placeholder={field.type === 'money' ? '$0.00' : field.type === 'percent' ? '0%' : ''}
                          value={values[field.key] || ''}
                          onChange={(e) => updateValue(field.key, e.target.value)}
                        />
                      )}
                      {field.helpText && <small className="text-muted-foreground text-[12px]">{field.helpText}</small>}
                    </label>
                  ))}

                  <div className="flex items-center gap-2 pt-1">
                    <button className={primaryButton} onClick={handleSaveDraft} disabled={busy}>
                      <Save className="w-4 h-4" /> {editingDraftId ? 'Update draft' : 'Save filled draft'}
                    </button>
                    <button className={ghostButton} onClick={() => { setValues({}); if (selected) refreshPreview(selected.id, {}); }}>
                      Clear
                    </button>
                  </div>

                  {savedDraftId && (
                    <div className="border border-border rounded-[16px] p-3 flex items-center justify-between gap-3">
                      <span className="text-[13px] text-muted-foreground">Draft saved — download it:</span>
                      <DownloadButtons draftId={savedDraftId} />
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Live preview */}
            <section className={`${panel} p-5 lg:max-h-[calc(100vh-300px)] lg:overflow-auto`}>
              <p className="text-[12px] uppercase tracking-[2px] text-muted-foreground mb-3">Live preview</p>
              <div className="bg-white text-black rounded-[12px] p-6 font-['Times_New_Roman',Times,serif] text-[13px] leading-[1.5] whitespace-pre-wrap filling-preview"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={`${panel} px-4 py-3`}>
      <p className="text-[22px] font-[800] leading-none">{value}</p>
      <p className="text-muted-foreground text-[12px] mt-1">{label}</p>
    </div>
  );
}

function Pill({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'good' }) {
  const toneClass = tone === 'good' ? 'border-emerald-400/40 text-emerald-200/90' : 'border-border text-muted-foreground';
  return <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${toneClass}`}>{children}</span>;
}

function DownloadButtons({ draftId }: { draftId: string }) {
  return (
    <div className="flex items-center gap-2">
      <a className={ghostButton} href={filingDraftDownloadUrl(draftId, 'docx')}>
        <Download className="w-4 h-4" /> DOCX
      </a>
      <a className={ghostButton} href={filingDraftDownloadUrl(draftId, 'pdf')}>
        <Download className="w-4 h-4" /> PDF
      </a>
    </div>
  );
}
