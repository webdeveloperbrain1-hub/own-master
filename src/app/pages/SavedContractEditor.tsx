import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, FileText, Loader2, RotateCcw, Save } from 'lucide-react';
import {
  ContractDocumentEditor,
  ContractDraftDownloadButton,
  plainEditorHtml,
} from '../components/ContractDocumentEditor';
import { ContractProgressPanel } from '../components/ContractProgress';
import { ProExportNotice } from '../billing/BillingContext';
import { DraftRecoveryNotice, useDraftRecovery } from '../components/DraftRecovery';
import { useUnsavedChanges } from '../components/UnsavedChanges';
import { useAuth } from '../auth/AuthContext';
import {
  fetchFilingDraft,
  fetchFilingTemplateFill,
  updateFilingDraft,
  type FilingDocumentLayout,
} from '../data/contractFilingClient';
import { getMusicProject, type MusicProject } from '../data/musicProjects';

const panel = 'min-w-0 border border-border bg-card rounded-[22px]';
const button =
  'micro-interaction inline-flex items-center justify-center gap-2 border border-border bg-muted text-foreground px-4 py-2.5 rounded-[14px] text-[14px] font-semibold hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${button} bg-primary text-primary-foreground hover:opacity-90`;
const input =
  'min-w-0 w-full rounded-[12px] border border-border bg-input text-foreground px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring';
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Could not load this contract. Please try again.';

type SavedDocument = {
  templateId: string;
  name: string;
  text: string;
  html: string;
  updatedAt: string;
};

export default function SavedContractEditorPage() {
  const { user } = useAuth();
  const { draftId } = useParams();
  return <SavedContractEditor key={`${user?.id}:${draftId}`} draftId={draftId || ''} />;
}

function SavedContractEditor({ draftId }: { draftId: string }) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const location = useLocation();
  const [project, setProject] = useState<MusicProject | null>(null);
  const [saved, setSaved] = useState<SavedDocument | null>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [html, setHtml] = useState('');
  const [editor, setEditor] = useState({ version: 0, html: '' });
  const [layout, setLayout] = useState<FilingDocumentLayout | null>(null);
  const [templateTitle, setTemplateTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState<string>(
    (location.state as { notice?: string } | null)?.notice || '',
  );
  const [retry, setRetry] = useState(0);
  const dirty = Boolean(
    saved &&
    (name !== saved.name || text !== saved.text || html !== saved.html),
  );
  const recovery = useDraftRecovery(user?.id || '', `saved-contract:${draftId}`, dirty, {
    templateId: saved?.templateId || '', name, text, html, baseUpdatedAt: saved?.updatedAt,
  });
  const markClean = useUnsavedChanges(dirty || Boolean(recovery.copy), busy, recovery.clear);

  function restoreRecovery() {
    if (!recovery.copy) return;
    const copy = recovery.copy;
    setName(copy.name);
    setText(copy.text);
    setHtml(copy.html);
    setEditor((current) => ({ version: current.version + 1, html: copy.html }));
    recovery.clear();
    setNotice('Unsaved edits restored. Save changes to keep them in your account.');
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const draft = await fetchFilingDraft(draftId);
        const source = await fetchFilingTemplateFill(draft.templateId);
        if (!active) return;
        const document = {
          templateId: draft.templateId,
          name: draft.name,
          text: draft.renderedText,
          html:
            draft.values?.__documentHtml || plainEditorHtml(draft.renderedText),
          updatedAt: draft.updatedAt,
        };
        setSaved(document);
        setName(document.name);
        setText(document.text);
        setHtml(document.html);
        setEditor((current) => ({
          version: current.version + 1,
          html: document.html,
        }));
        setLayout(source.documentLayout);
        setTemplateTitle(source.template.title);
      } catch (error) {
        if (active) setLoadError(message(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [draftId, retry]);

  useEffect(() => {
    let active = true;
    setProject(null);
    if (projectId)
      void getMusicProject(projectId)
        .then((value) => {
          if (active) setProject(value);
        })
        .catch(() => {
          /* Project context is optional; contract ownership is checked separately. */
        });
    return () => {
      active = false;
    };
  }, [projectId]);

  async function save() {
    if (!saved || !name.trim() || !text.trim()) return;
    setBusy(true);
    setSaveError('');
    setNotice('');
    try {
      const result = await updateFilingDraft(draftId, name.trim(), text, html);
      setSaved({
        templateId: saved.templateId,
        name: result.draft.name,
        text,
        html,
        updatedAt: result.draft.updatedAt,
      });
      setName(result.draft.name);
      recovery.clear();
      markClean();
      setNotice(
        'Changes saved. Your contract progress and signed copies are kept.',
      );
    } catch (error) {
      setSaveError(message(error));
    } finally {
      setBusy(false);
    }
  }

  function discardChanges() {
    if (
      !saved ||
      !window.confirm(
        'Discard your unsaved changes and return to the last saved version?',
      )
    )
      return;
    setName(saved.name);
    recovery.clear();
    setText(saved.text);
    setHtml(saved.html);
    setEditor((current) => ({
      version: current.version + 1,
      html: saved.html,
    }));
    setSaveError('');
    setNotice('Unsaved changes discarded.');
  }

  const back = (
    <Link
      to={
        project ? `/dashboard/projects/${project.id}` : '/dashboard/contracts'
      }
      className="inline-flex items-center gap-2 text-[14px] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {project ? `Back to ${project.title}` : 'Back to contracts'}
    </Link>
  );
  if (loading)
    return (
      <main className="min-w-0 grid grid-cols-1 gap-4">
        {back}
        <section
          className={`${panel} p-8 flex items-center gap-2 text-muted-foreground`}
          role="status"
        >
          <Loader2 className="size-5 animate-spin" /> Loading saved contract…
        </section>
      </main>
    );
  if (loadError || !saved || !layout)
    return (
      <main className="min-w-0 grid grid-cols-1 gap-4">
        {back}
        <section className={`${panel} p-6`}>
          <h1 className="text-[26px] font-semibold">Contract unavailable</h1>
          <p role="alert" className="text-muted-foreground mt-3">
            {loadError || 'This saved contract could not be opened.'}
          </p>
          <button
            className={`${button} mt-4`}
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        </section>
      </main>
    );

  return (
    <main className="min-w-0 grid grid-cols-1 gap-5">
      {back}
      <header data-reveal className={`${panel} p-5 sm:p-6`}>
        <p className="flex items-center gap-2 text-[12px] uppercase tracking-[2px] text-muted-foreground">
          <FileText className="size-4" /> Edit saved contract
        </p>
        <h1 className="mt-2 text-[28px] sm:text-[34px] font-semibold leading-tight break-words">
          {saved.name}
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {templateTitle} · Last saved{' '}
          {new Date(saved.updatedAt).toLocaleString()}
        </p>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Edit the working document here. Uploaded signed PDFs remain separate
          from these edits.
        </p>
      </header>
      {recovery.copy && <DraftRecoveryNotice onRestore={restoreRecovery} onDiscard={recovery.clear} busy={busy} changedOnServer={Boolean(recovery.copy.baseUpdatedAt && recovery.copy.baseUpdatedAt !== saved.updatedAt)} />}
      {recovery.unavailable && <p role="alert" className="text-sm text-muted-foreground">This browser cannot keep a recovery copy. Save your changes before leaving.</p>}
      {notice && (
        <p role="status" className="text-[14px] text-muted-foreground">
          {notice}
        </p>
      )}
      {saveError && (
        <p
          role="alert"
          className="rounded-[14px] border border-destructive/40 bg-destructive/10 p-3 text-red-700 dark:text-red-200"
        >
          {saveError}
        </p>
      )}
      <section
        data-reveal="none"
        className={`${panel} p-4 sm:p-5`}
        aria-label="Saved contract editor"
      >
        <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
          <div>
            <h2 className="text-[20px] font-semibold">Working document</h2>
            <p
              id="contract-editor-help"
              className="mt-1 text-[13px] text-muted-foreground"
            >
              Edit the document text, then save your changes.
            </p>
          </div>
          <div className="editor-actions min-w-0 max-w-full flex flex-wrap gap-2 items-center">
            {dirty && (
              <span className="text-[12px] text-muted-foreground">
                Unsaved changes
              </span>
            )}
            <button
              className={button}
              onClick={discardChanges}
              disabled={busy || !dirty}
            >
              <RotateCcw className="size-4" /> Discard changes
            </button>
            <button
              className={primary}
              onClick={() => void save()}
              disabled={busy || Boolean(recovery.copy) || !dirty || !name.trim() || !text.trim()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <ContractDraftDownloadButton
              draftId={draftId}
              disabled={busy || dirty || Boolean(recovery.copy)}
            />
          </div>
        </div>
        <label className="grid gap-2 text-[14px] mb-4">
          Contract name
          <input
            className={input}
            value={name}
            maxLength={240}
            required
            disabled={busy || Boolean(recovery.copy)}
            onChange={(event) => {
              setName(event.target.value);
              setNotice('');
            }}
          />
        </label>
        <ContractDocumentEditor
          key={editor.version}
          initialHtml={editor.html}
          layout={layout}
          disabled={busy || Boolean(recovery.copy)}
          onChange={(value, documentHtml) => {
            setText(value);
            setHtml(documentHtml);
            setNotice('');
          }}
        />
        {dirty && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Save your changes to download the updated draft or change its
            progress.
          </p>
        )}
      </section>
      <ProExportNotice />
      <ContractProgressPanel
        source="filing"
        contractId={draftId}
        disabled={busy || dirty || Boolean(recovery.copy)}
      />
    </main>
  );
}
