import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { getMusicProject, type MusicProject } from '../data/musicProjects';
import { ContractDocumentEditor } from '../components/ContractDocumentEditor';
import { DraftRecoveryNotice, useDraftRecovery } from '../components/DraftRecovery';
import { useUnsavedChanges } from '../components/UnsavedChanges';
import { useAuth } from '../auth/AuthContext';
import { guidePreviewPath, savedContractEditorPath } from '../data/contractLinks';
import { BookOpen, Loader2, RefreshCw, Save, Search, Sparkles } from 'lucide-react';
import {
  fetchFilingSummary,
  fetchFilingTemplateFill,
  fetchFilingTemplates,
  downloadFilingOriginal,
  saveFilingDraft,
  type FilingSummary,
  type FilingTemplateListItem,
  type FilingTemplateMeta,
  type FilingDocumentLayout,
} from '../data/contractFilingClient';

const primaryButton =
  'micro-interaction inline-flex items-center justify-center gap-2 border border-primary bg-primary text-primary-foreground px-[15px] py-[11px] rounded-[14px] font-[750] cursor-pointer hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed';
const ghostButton =
  'micro-interaction inline-flex items-center justify-center gap-2 border border-border bg-muted text-foreground px-[14px] py-[10px] rounded-[14px] font-[700] cursor-pointer hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed';
const panel =
  'border border-border bg-gradient-to-b from-[var(--panel-top)] to-[var(--panel-bottom)] rounded-[22px]';
const inputClass =
  'w-full bg-[rgba(255,255,255,.04)] border border-border rounded-[12px] px-[12px] py-[9px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors';

export default function ContractFillerPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('draft');
  const projectId = searchParams.get('project');
  if (draftId)
    return (
      <Navigate to={savedContractEditorPath(draftId, projectId)} replace />
    );
  return (
    <NewContractFillerPage key={`${user?.id}:${projectId || 'new'}`} projectId={projectId} />
  );
}

function NewContractFillerPage({ projectId }: { projectId: string | null }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [songProject, setSongProject] = useState<MusicProject | null>(null);
  const [projectError, setProjectError] = useState('');
  useEffect(() => {
    let active = true;
    setSongProject(null);
    setProjectError('');
    if (projectId)
      void getMusicProject(projectId)
        .then((project) => {
          if (active) setSongProject(project);
        })
        .catch((error) => {
          if (active)
            setProjectError(
              error instanceof Error
                ? error.message
                : 'Project could not be loaded.',
            );
        });
    return () => {
      active = false;
    };
  }, [projectId]);
  const [templates, setTemplates] = useState<FilingTemplateListItem[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateLoadError, setTemplateLoadError] = useState('');
  const templateRequest = useRef(0);
  const [query, setQuery] = useState('');
  const [libraryKind, setLibraryKind] = useState<'template' | 'guide'>('guide');
  const [category, setCategory] = useState('');
  const [commonOnly, setCommonOnly] = useState(false);
  const [summary, setSummary] = useState<FilingSummary | null>(null);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<FilingTemplateMeta | null>(null);
  const [draftName, setDraftName] = useState('');
  const [editorDocument, setEditorDocument] = useState({
    version: 0,
    text: '',
    html: '',
  });
  const [documentText, setDocumentText] = useState('');
  const [documentHtml, setDocumentHtml] = useState('');
  const [templateText, setTemplateText] = useState('');
  const [templateHtml, setTemplateHtml] = useState('');
  const [documentLayout, setDocumentLayout] =
    useState<FilingDocumentLayout | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [saving, setSaving] = useState(false);
  const recovery = useDraftRecovery(user?.id || '', `new-contract:${projectId || 'standalone'}`, hasUnsavedChanges, {
    templateId: selected?.id || '', name: draftName, text: documentText, html: documentHtml,
  });
  const markClean = useUnsavedChanges(hasUnsavedChanges || Boolean(recovery.copy), saving, recovery.clear);

  const loadEditor = useCallback((text: string, html: string) => {
    setEditorDocument((current) => ({
      version: current.version + 1,
      text,
      html,
    }));
    setDocumentText(text);
    setDocumentHtml(html);
    setHasUnsavedChanges(false);
  }, []);

  const loadTemplates = useCallback(async (q: string) => {
    const request = ++templateRequest.current;
    setLoadingTemplates(true);
    setTemplateLoadError('');
    try {
      const result = await fetchFilingTemplates(q, { kind: libraryKind, category, commonOnly });
      if (request === templateRequest.current) setTemplates(result);
    } catch (error) {
      if (request === templateRequest.current)
        setTemplateLoadError(
          error instanceof Error ? error.message : 'Failed to load templates.',
        );
    } finally {
      if (request === templateRequest.current) setLoadingTemplates(false);
    }
  }, [libraryKind, category, commonOnly]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await fetchFilingSummary());
    } catch {
      /* summary is non-critical */
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(
      () => void loadTemplates(query),
      query.trim() ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      // Invalidate the previous query immediately, including during the
      // debounce delay, so a slower response cannot restore stale matches.
      templateRequest.current += 1;
    };
  }, [query, loadTemplates]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  async function restoreRecovery() {
    const copy = recovery.copy;
    if (!copy) return;
    setLoadingTemplate(true);
    try {
      const data = await fetchFilingTemplateFill(copy.templateId);
      setSelected(data.template);
      setTemplateText(data.renderedText);
      setTemplateHtml(data.documentHtml);
      setDocumentLayout(data.documentLayout);
      setDraftName(copy.name);
      loadEditor(copy.text, copy.html);
      recovery.clear();
      setHasUnsavedChanges(true);
      setStatus('Unsaved edits restored. Save your draft to keep them in your account.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not restore the unsaved draft.');
    } finally { setLoadingTemplate(false); }
  }

  async function selectTemplate(id: string) {
    if (
      hasUnsavedChanges &&
      !window.confirm('Open another template and discard your unsaved edits?')
    )
      return;
    setLoadingTemplate(true);
    try {
      const data = await fetchFilingTemplateFill(id);
      recovery.clear();
      setSelected(data.template);
      setDraftName(
        songProject
          ? `${songProject.title} - ${data.template.title}`
          : `${data.template.title} - draft`,
      );
      setTemplateText(data.renderedText);
      setTemplateHtml(data.documentHtml);
      setDocumentLayout(data.documentLayout);
      loadEditor(data.renderedText, data.documentHtml);
      setStatus('');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to open template.',
      );
    } finally {
      setLoadingTemplate(false);
    }
  }

  function updateDocument(text: string, html: string) {
    setDocumentText(text);
    setDocumentHtml(html);
    setHasUnsavedChanges(true);
    setStatus('');
  }

  function resetDocument() {
    if (
      hasUnsavedChanges &&
      !window.confirm('Replace your edits with the original template text?')
    )
      return;
    loadEditor(templateText, templateHtml);
    setHasUnsavedChanges(true);
    setStatus('');
  }

  async function handleSaveDraft() {
    if (!selected) return;
    setBusy(true);
    setSaving(true);
    setStatus('');
    try {
      const result = await saveFilingDraft(
        selected.id,
        draftName,
        documentText,
        documentHtml,
        songProject?.id,
      );
      setHasUnsavedChanges(false);
      recovery.clear();
      const leaving = markClean();
      if (!leaving) navigate(savedContractEditorPath(result.draft.id, projectId), {
        replace: true,
        state: {
          notice: `Contract saved.${songProject ? ` Attached to ${songProject.title}.` : ''}`,
        },
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to save draft.',
      );
    } finally {
      setBusy(false);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {projectId &&
        (projectError ? (
          <p role="alert" className="text-red-700 dark:text-red-200">
            {projectError} Open this song again before creating its contract.
          </p>
        ) : songProject ? (
          <div className={`${panel} p-4 text-[14px]`}>
            <Link
              to={`/dashboard/projects/${songProject.id}`}
              className="underline font-semibold"
            >
              ← {songProject.title}
            </Link>
            <p className="text-muted-foreground mt-1">
              Saved drafts attach to this song automatically. Fill in the song
              and deal details in the document below.
            </p>
          </div>
        ) : (
          <p role="status" className="text-muted-foreground">
            Loading song project…
          </p>
        ))}
      {/* Header */}
      <header
        data-reveal
        className={`${panel} p-5 flex flex-wrap items-center justify-between gap-4`}
      >
        <div>
          <p className="text-[12px] uppercase tracking-[2px] text-muted-foreground flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" /> Contract Filler
          </p>
          <h1 className="text-[26px] font-[800] mt-1 break-words">
            {libraryKind === 'guide' ? 'Guides & Resources' : 'Fill a contract template'}
          </h1>
          <p className="text-muted-foreground text-[14px] mt-1 max-w-[560px]">
            {libraryKind === 'guide'
              ? 'Read the library guides in a read-only preview. Switch to Contract templates when you are ready to create a draft.'
              : 'Pick a template, edit the contract directly in the live preview, then save and download your draft.'}
          </p>
        </div>
      </header>

      {recovery.copy && <DraftRecoveryNotice onRestore={() => void restoreRecovery()} onDiscard={recovery.clear} busy={loadingTemplate} />}
      {recovery.unavailable && <p role="alert" className="text-sm text-muted-foreground">This browser cannot keep a recovery copy. Save your draft before leaving.</p>}

      {status && (
        <div
          className={`${panel} px-4 py-3 text-[13px] text-muted-foreground flex items-center gap-2`}
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {status}
        </div>
      )}

      <section className={`${panel} min-w-0 p-4`} aria-label="Contract library">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto" role="group" aria-label="Library section">
            {([['template', 'Contract templates'], ['guide', 'Guides & Resources']] as const).map(([kind, label]) => (
              <button key={kind} type="button" aria-pressed={libraryKind === kind} className={`${libraryKind === kind ? primaryButton : ghostButton} text-[13px]`} onClick={() => { setLibraryKind(kind); setCategory(''); setCommonOnly(false); }}>{label}</button>
            ))}
          </div>
          <div className="relative w-full max-w-[320px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              aria-label={libraryKind === 'guide' ? 'Search guides and resources' : 'Search contract templates'}
              className={`${inputClass} pl-9`}
              placeholder="Search names, types, or source files..."
              value={query}
              onChange={(event) => {
                templateRequest.current += 1;
                setQuery(event.target.value);
                setLoadingTemplates(true);
                setTemplateLoadError('');
              }}
            />
          </div>
        </div>
        {libraryKind === 'template' && <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
          {libraryKind === 'template' && <label className="flex min-w-0 max-w-full items-center gap-2">Category<select aria-label="Template category" className={`${inputClass} min-w-0`} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{summary?.categories.map((entry) => <option key={entry.category || 'other'} value={entry.category || ''}>{entry.category} ({entry._count._all})</option>)}</select></label>}
          {libraryKind === 'template' && <label className="flex items-center gap-2"><input type="checkbox" checked={commonOnly} onChange={(event) => setCommonOnly(event.target.checked)} />Common contract types</label>}
        </div>}
        <p className="mb-3 text-[12px] text-muted-foreground">
          {libraryKind === 'guide'
            ? 'Explore guides to music agreements, publishing, and the business behind your catalog.'
            : 'Find an agreement for your music project, then open a template to start your draft.'}
        </p>
        {!loadingTemplates && !templateLoadError && (
          <p role="status" className="mb-3 text-[12px] text-muted-foreground">
            {templates.length} {query.trim() || category || commonOnly ? 'matching ' : ''}
            {libraryKind === 'guide' ? (templates.length === 1 ? 'guide' : 'guides') : (templates.length === 1 ? 'template' : 'templates')}
          </p>
        )}
        {loadingTemplates ? (
          <div
            className="flex items-center justify-center gap-2 text-muted-foreground text-[13px] py-6"
            role="status"
          >
            <Loader2 className="w-4 h-4 animate-spin" /> Loading contract
            templates...
          </div>
        ) : templateLoadError ? (
          <div className="flex flex-wrap items-center justify-center gap-3 py-6">
            <p className="text-muted-foreground text-[13px]" role="alert">
              {templateLoadError}
            </p>
            <button
              className={ghostButton}
              onClick={() => {
                void loadTemplates(query);
                void loadSummary();
              }}
            >
              Try again
            </button>
          </div>
        ) : templates.length === 0 ? (
          <p className="text-muted-foreground text-[13px] py-6 text-center">
            {query.trim()
              ? 'No documents match your search. Try a different name or category.'
              : 'No documents match these filters.'}
          </p>
        ) : (
          <div data-reveal-group className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => template.kind === 'guide' ? navigate(guidePreviewPath(template.id, projectId)) : void selectTemplate(template.id)}
                disabled={
                  busy || loadingTemplate || Boolean(recovery.copy) || Boolean(projectId && !songProject)
                }
                className={`min-w-0 text-left border rounded-[16px] p-3 transition-colors ${
                  selected?.id === template.id
                    ? 'border-primary bg-accent'
                    : 'border-border bg-[rgba(255,255,255,.03)] hover:bg-accent'
                }`}
              >
                <p className="font-[700] text-[14px] leading-tight line-clamp-2 min-h-[34px]">
                  {template.title}
                </p>
                <p className="mt-1 break-all text-[11px] text-muted-foreground">{template.originalName}</p>
                <p className="mt-2 line-clamp-2 text-[12px] text-muted-foreground">{template.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Pill>{template.category || 'Template'}</Pill>
                  {template.commonType && <Pill>Common type</Pill>}
                  {template.variant && <Pill>{template.variant}</Pill>}
                  {template.draftCount > 0 && (
                    <Pill tone="good">{template.draftCount} drafts</Pill>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{template.extractionLabel} · {template.analysisLabel}</p>
                {template.kind === 'guide' && <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold"><BookOpen className="size-3.5" />Preview guide</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Document editor and saved drafts */}
      {(libraryKind === 'template' || selected || loadingTemplate) && <div className="flex flex-col gap-4">
        {loadingTemplate ? (
          <section
            className={`${panel} p-12 flex justify-center text-muted-foreground`}
            aria-label="Loading contract"
          >
            <Loader2 className="w-5 h-5 animate-spin" />
          </section>
        ) : !selected ? (
          <section
            className={`${panel} p-8 lg:col-span-2 flex items-center justify-center`}
          >
            <p className="text-muted-foreground text-center">
              Select a contract template to start editing.
            </p>
          </section>
        ) : (
          <section className={`${panel} p-4 sm:p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-[12px] uppercase tracking-[2px] text-muted-foreground mb-1">
                  Live preview · editable
                </p>
                <h2 className="text-[18px] font-[750] leading-tight">
                  {selected.title}
                </h2>
                <p
                  id="contract-editor-help"
                  className="text-muted-foreground text-[13px] mt-2"
                >
                  Click the document to fill the original blanks or edit the
                  wording. Use zoom for a closer view.
                </p>
              </div>
              <div className="flex items-center flex-wrap gap-2">
                {hasUnsavedChanges && <Pill>Unsaved changes</Pill>}
                <button
                  className={ghostButton}
                  onClick={resetDocument}
                  disabled={busy}
                >
                  <RefreshCw className="w-4 h-4" /> Reset to template
                </button>
                <button
                  className={primaryButton}
                  onClick={handleSaveDraft}
                  disabled={
                    busy ||
                    !documentText.trim() ||
                    Boolean(projectId && !songProject)
                  }
                >
                  {busy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save draft
                </button>
              </div>
            </div>
            <label className="grid gap-2 text-[14px] mb-4">
              Draft name
              <input
                className={inputClass}
                value={draftName}
                onChange={(event) => {
                  setDraftName(event.target.value);
                  setHasUnsavedChanges(true);
                }}
                maxLength={240}
                disabled={busy}
              />
            </label>
            <div className="max-w-[1100px] mx-auto">
              {documentLayout && (
                <ContractDocumentEditor
                  key={editorDocument.version}
                  initialHtml={editorDocument.html}
                  layout={documentLayout}
                  disabled={busy}
                  onChange={updateDocument}
                />
              )}
            </div>
            <p className="text-muted-foreground text-[12px] mt-3">
              Save your draft to download the latest edits as a PDF.{' '}
              <button
                className="underline"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void downloadFilingOriginal(selected.id)
                    .catch((error) =>
                      setStatus(
                        error instanceof Error
                          ? error.message
                          : 'Download failed.',
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Download original template
              </button>
            </p>
          </section>
        )}
      </div>}
    </div>
  );
}

function Pill({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'good';
}) {
  const toneClass =
    tone === 'good'
      ? 'border-emerald-400/40 text-emerald-700 dark:text-emerald-200/90'
      : 'border-border text-muted-foreground';
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full border ${toneClass}`}
    >
      {children}
    </span>
  );
}
