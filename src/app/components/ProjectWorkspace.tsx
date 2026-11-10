import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileAudio,
  FileText,
  Loader2,
  MessageSquare,
  Music2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../data/apiClient';
import { savedContractEditorPath } from '../data/contractLinks';
import { ContractStageBadge } from './ContractProgress';
import { useUnsavedChanges } from './UnsavedChanges';
import { DraftRecoveryNotice } from './DraftRecovery';
import { ProjectRecoveryWarning, useProjectRecovery } from './ProjectRecovery';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { fetchContractProgressList } from '../data/contractProgressClient';
import { listContracts } from '../data/contracts';
import {
  downloadFilingDraft,
  fetchFilingDrafts,
} from '../data/contractFilingClient';
import {
  mergeContractInventory,
  type ContractListItem,
} from '../data/contractInventory';
import {
  AUDIO_ACCEPT,
  addProjectNote,
  attachProjectContract,
  createMusicProject,
  deleteMusicProject,
  detachProjectContract,
  getMusicProject,
  listMusicProjects,
  migrateBrowserProjects,
  updateMusicProject,
  uploadProjectAudio,
  type MusicProject,
} from '../data/musicProjects';

const panel = 'border border-border bg-card rounded-[22px]';
const button =
  'micro-interaction inline-flex items-center justify-center gap-2 rounded-[14px] border border-border bg-muted px-4 py-2.5 text-[14px] font-semibold hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed';
const primary = `${button} bg-primary text-primary-foreground hover:opacity-90`;
const input =
  'w-full min-w-0 rounded-[14px] border border-border bg-input px-3.5 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const fileSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function ErrorNotice({ children }: { children: string }) {
  return children ? (
    <p
      role="alert"
      className="rounded-[14px] border border-destructive/40 bg-destructive/10 p-3 text-[14px] text-red-700 dark:text-red-200"
    >
      {children}
    </p>
  ) : null;
}

function ProjectAudio({ project }: { project: MusicProject }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    setError('');
    if (project.hasAudio) {
      void apiFetch(`/api/projects/${project.id}/audio`, {
        signal: controller.signal,
      })
        .then((response) => response.blob())
        .then((blob) => {
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(message(err));
        });
    }
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [project.id, project.hasAudio, project.audioVersion, retry]);
  if (!project.hasAudio)
    return (
      <p className="text-[14px] text-muted-foreground">
        Your project is saved. You can add audio whenever you’re ready.
      </p>
    );
  if (error)
    return (
      <div>
        <ErrorNotice>{error}</ErrorNotice>
        {url && (
          <a
            href={url}
            download={project.fileName || 'audio'}
            className="block text-[13px] underline mb-3"
          >
            Download audio
          </a>
        )}
        <button
          className={button}
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry audio
        </button>
      </div>
    );
  if (!url)
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-[14px] text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" /> Loading audio…
      </p>
    );
  return (
    <div className="grid gap-2">
      <audio
        aria-label={`Play ${project.title}`}
        controls
        preload="metadata"
        src={url}
        className="w-full"
        onError={() =>
          setError(
            'This browser could not play the audio. Download it or upload an MP3 or WAV version.',
          )
        }
      />
      <a
        href={url}
        download={project.fileName || 'audio'}
        className="inline-flex items-center gap-2 text-[13px] text-muted-foreground underline justify-self-start"
      >
        <Download className="size-3.5" /> Download audio
      </a>
    </div>
  );
}

export function TrackReviewWorkspace() {
  const { user } = useAuth();
  return <TrackReviewForm key={user?.id || ''} ownerId={user?.id || ''} />;
}

function TrackReviewForm({ ownerId }: { ownerId: string }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<MusicProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [audioToReselect, setAudioToReselect] = useState('');
  const [retry, setRetry] = useState(0);
  const dirty = Boolean(title || lyrics || file || audioToReselect);
  const recovery = useProjectRecovery(ownerId, 'new', dirty, {
    title, lyrics, note: '', detailsDirty: dirty, audioFileName: file?.name || audioToReselect,
  });
  const markClean = useUnsavedChanges(dirty || Boolean(recovery.copy), busy, recovery.clear);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void listMusicProjects()
      .then(async (items) => {
        if (!active) return;
        setProjects(items);
        if (ownerId) {
          try {
            const migrated = await migrateBrowserProjects(ownerId, items);
            if (active) setProjects(migrated);
          } catch {
            if (active)
              setError(
                'Some older tracks could not be imported. Their original browser copies are still saved. Try again to import them.',
              );
          }
        }
      })
      .catch((err) => {
        if (active) setError(message(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ownerId, retry]);

  async function addTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (audioToReselect && !file) {
      setError('Choose the audio file again, or remove it, before saving.');
      return;
    }
    if (!file && !lyrics.trim()) {
      setError('Add lyrics or choose a music file to save this project.');
      return;
    }
    setBusy(true);
    try {
      const project = await createMusicProject(title, lyrics, file);
      recovery.clear();
      setTitle('');
      setLyrics('');
      setFile(null);
      setAudioToReselect('');
      const leaving = markClean();
      if (!leaving) navigate(`/dashboard/projects/${project.id}`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${panel} p-5`} aria-label="Song projects">
      <div data-reveal className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="flex items-center gap-2 m-0 text-[24px] tracking-tight">
            <FileAudio className="size-5" /> Track review workspace
          </h2>
          <p className="text-[14px] text-muted-foreground mt-1">
            Start with lyrics, audio, or both. Keep notes and connect your
            contracts.
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground">
          {projects.length} tracks
        </span>
      </div>
      {recovery.copy && <div className="mb-4"><DraftRecoveryNotice busy={busy} documentLabel="project" onDiscard={recovery.clear} onRestore={() => {
        const copy = recovery.copy!;
        setTitle(copy.title);
        setLyrics(copy.lyrics);
        setAudioToReselect(copy.audioFileName);
        recovery.clear();
      }} /></div>}
      <ProjectRecoveryWarning unavailable={recovery.unavailable} />
      {audioToReselect && <p role="status" className="mb-4 text-sm text-muted-foreground">
        Choose “{audioToReselect}” again to include its audio. Browsers cannot restore a selected file after refresh.{' '}
        <button type="button" className="underline" onClick={() => setAudioToReselect('')}>Remove audio selection</button>
      </p>}
      <form
        onSubmit={addTrack}
        className="grid sm:grid-cols-2 gap-3 mb-6"
        aria-label="Add a song"
      >
        <label className="grid gap-2 text-[14px]">
          Track title
          <input
            className={input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Night Drive"
            required
            maxLength={160}
            disabled={busy || Boolean(recovery.copy)}
          />
        </label>
        <label className="grid gap-2 text-[14px]">
          Music file (optional if you add lyrics)
          <input
            className={`${input} file:mr-2 file:text-foreground`}
            type="file"
            accept={AUDIO_ACCEPT}
            onChange={(e) => {
              const chosen = e.target.files?.[0] || null;
              setFile(chosen);
              if (chosen) setAudioToReselect('');
            }}
            disabled={busy || Boolean(recovery.copy)}
          />
        </label>
        <label className="grid gap-2 text-[14px] sm:col-span-2">
          Lyrics (optional if you add music)
          <textarea
            className={`${input} min-h-[100px]`}
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="Lyrics, hook ideas, or reference notes…"
            maxLength={20000}
            disabled={busy || Boolean(recovery.copy)}
          />
        </label>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button className={primary} disabled={busy || Boolean(recovery.copy)}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {busy ? 'Saving your project…' : 'Save project'}
          </button>
          <span className="text-[12px] text-muted-foreground">
            MP3, WAV, M4A, FLAC, OGG, WebM · Up to 50 MB · Saved to your account
          </span>
        </div>
      </form>
      <ErrorNotice>{error}</ErrorNotice>
      {error && (
        <button
          className={`${button} mb-4`}
          onClick={() => setRetry((value) => value + 1)}
          disabled={busy}
        >
          Try again
        </button>
      )}
      {loading ? (
        <p role="status" className="text-muted-foreground">
          Loading your tracks…
        </p>
      ) : projects.length ? (
        <div data-reveal-group className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/dashboard/projects/${project.id}`}
              className="motion-card min-w-0 rounded-[18px] border border-border bg-muted p-4 hover:bg-accent group"
            >
              <div className="flex items-start justify-between gap-3">
                <Music2 className="size-5 text-muted-foreground" />
                <ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
              </div>
              <h3 className="text-[18px] font-bold mt-3 break-words">
                {project.title}
              </h3>
              <p className="text-[12px] text-muted-foreground mt-1 truncate">
                {project.hasAudio
                  ? `${project.fileName} · ${fileSize(project.fileSize)}`
                  : 'Audio optional · Add a file anytime'}
              </p>
              <div className="flex flex-wrap gap-3 mt-4 text-[12px] text-muted-foreground">
                <span>{project.contracts.length} contracts</span>
                <span>{project.comments.length} notes</span>
                <span>Updated {date(project.updatedAt)}</span>
              </div>
              <span className="block mt-3 text-[13px] font-semibold">
                Open project →
              </span>
            </Link>
          ))}
        </div>
      ) : (
        !error && (
          <div className="rounded-[18px] border border-dashed border-border bg-muted p-8 text-center">
            <Music2 className="size-7 mx-auto mb-3 text-muted-foreground" />
            <h3 className="text-[20px]">Your next song starts here.</h3>
            <p className="text-[14px] text-muted-foreground mt-2">
              Add your first track to keep its audio, lyrics, notes, and
              agreements together.
            </p>
          </div>
        )
      )}
    </section>
  );
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  return <ProjectDetail key={`${user?.id || ''}:${id || ''}`} id={id || ''} ownerId={user?.id || ''} />;
}

function ProjectDetail({ id, ownerId }: { id: string; ownerId: string }) {
  const navigate = useNavigate();
  const [project, setProject] = useState<MusicProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [note, setNote] = useState('');
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [contractError, setContractError] = useState('');
  const [contractsLoading, setContractsLoading] = useState(true);
  const [contractSelection, setContractSelection] = useState('');
  const [section, setSection] = useState('Overview');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [cancelEditing, setCancelEditing] = useState(false);
  const audioInput = useRef<HTMLInputElement>(null);
  const [retry, setRetry] = useState(0);
  const detailsDirty = Boolean(editing && project && (title !== project.title || lyrics !== project.lyrics));
  const dirty = detailsDirty || Boolean(note);
  const recovery = useProjectRecovery(ownerId, id, dirty, {
    title, lyrics, note, detailsDirty, audioFileName: '', baseUpdatedAt: project?.updatedAt,
  });
  const markClean = useUnsavedChanges(dirty || Boolean(recovery.copy), busy, recovery.clear);

  function discardDetails() {
    setTitle(project?.title || '');
    setLyrics(project?.lyrics || '');
    setEditing(false);
    setCancelEditing(false);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setProject(null);
    setEditing(false);
    void getMusicProject(id || '')
      .then((item) => {
        if (active) {
          setProject(item);
          setTitle(item.title);
          setLyrics(item.lyrics);
        }
      })
      .catch((err) => {
        if (active) setError(message(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, ownerId, retry]);

  useEffect(() => {
    let active = true;
    setContractsLoading(true);
    setContractError('');
    void Promise.allSettled([listContracts(), fetchFilingDrafts(), fetchContractProgressList()])
      .then(([account, filing, progress]) => {
        if (!active) return;
        setContracts(
          mergeContractInventory(
            account.status === 'fulfilled' ? account.value : [],
            filing.status === 'fulfilled' ? filing.value : [],
            progress.status === 'fulfilled' ? progress.value : [],
          ),
        );
        if (account.status === 'rejected' || filing.status === 'rejected' || progress.status === 'rejected')
          setContractError(
            'Some contracts could not be loaded. Refresh this page to try again.',
          );
      })
      .finally(() => {
        if (active) setContractsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, ownerId, retry]);

  async function act(operation: () => Promise<MusicProject>, success: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setProject(await operation());
      setNotice(success);
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className={`${panel} p-8`} role="status">
        Loading your project…
      </main>
    );
  if (!project)
    return (
      <main className={`${panel} p-6`}>
        <ErrorNotice>{error}</ErrorNotice>
        <button
          className={button}
          onClick={() => setRetry((value) => value + 1)}
        >
          Try again
        </button>
        <Link to="/dashboard" className={`${button} ml-2`}>
          Back to dashboard
        </Link>
      </main>
    );
  const song = project;
  const available = contracts.filter(
    (contract) =>
      !song.contracts.some((link) =>
        link.draftId
          ? link.draftId === contract.filingDraftId
          : link.accountContractId === contract.id,
      ),
  );
  const createUrl = `/dashboard/contract-filler?project=${encodeURIComponent(song.id)}`;

  return (
    <main className="grid gap-5">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 text-[14px] text-muted-foreground justify-self-start"
      >
        <ArrowLeft className="size-4" /> All song projects
      </Link>
      <header data-reveal className={`${panel} p-5 sm:p-7`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] uppercase tracking-[2px] text-muted-foreground">
              Song project
            </p>
            <h1 className="text-[32px] sm:text-[42px] leading-tight tracking-tight mt-2 break-words">
              {song.title}
            </h1>
            <p className="text-[13px] text-muted-foreground mt-2">
              Updated {date(song.updatedAt)} · {song.contracts.length} attached
              contracts
            </p>
          </div>
          <button
            className={button}
            disabled={busy || editing || Boolean(recovery.copy)}
            onClick={() => {
              setTitle(song.title);
              setLyrics(song.lyrics);
              setEditing(true);
              setSection('Overview');
            }}
          >
            Edit details
          </button>
        </div>
        <div className="mt-6 rounded-[18px] border border-border bg-muted p-4">
          <div className="flex flex-wrap justify-between gap-3 mb-3">
            <p className="text-[13px] text-muted-foreground break-all">
              {song.hasAudio
                ? `${song.fileName} · ${fileSize(song.fileSize)}`
                : 'Add audio to this project'}
            </p>
            <label
              className={`text-[13px] underline ${busy ? 'opacity-50' : 'cursor-pointer'}`}
            >
              {busy
                ? 'Please wait…'
                : song.hasAudio
                  ? 'Replace audio'
                  : 'Upload audio'}
              <input
                ref={audioInput}
                className="sr-only"
                type="file"
                accept={AUDIO_ACCEPT}
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void act(
                      () => uploadProjectAudio(song.id, file),
                      'Audio saved.',
                    ).finally(() => {
                      if (audioInput.current) audioInput.current.value = '';
                    });
                }}
              />
            </label>
          </div>
          <ProjectAudio project={song} />
        </div>
      </header>
      <ErrorNotice>{error}</ErrorNotice>
      {notice && (
        <p role="status" className="text-[14px] text-muted-foreground">
          {notice}
        </p>
      )}
      <nav aria-label="Project sections" className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        {['Overview', 'Contracts', 'Notes'].map((name) => (
          <button
            key={name}
            className={`micro-interaction min-h-11 min-w-0 rounded-[14px] border px-2 sm:px-4 py-2.5 text-[12px] sm:text-[14px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${section === name ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted hover:bg-accent'}`}
            aria-pressed={section === name}
            onClick={() => setSection(name)}
          >
            {name}
            {name === 'Contracts'
              ? ` (${song.contracts.length})`
              : name === 'Notes'
                ? ` (${song.comments.length})`
                : ''}
          </button>
        ))}
      </nav>
      {recovery.copy && <DraftRecoveryNotice busy={busy} documentLabel="project" changedOnServer={Boolean(recovery.copy.baseUpdatedAt && recovery.copy.baseUpdatedAt !== song.updatedAt)} onDiscard={recovery.clear} onRestore={() => {
        const copy = recovery.copy!;
        if (copy.detailsDirty) {
          setTitle(copy.title);
          setLyrics(copy.lyrics);
          setEditing(true);
        }
        setNote(copy.note);
        setSection(copy.detailsDirty ? 'Overview' : 'Notes');
        recovery.clear();
      }} />}
      <ProjectRecoveryWarning unavailable={recovery.unavailable} />
      <AlertDialog open={cancelEditing} onOpenChange={setCancelEditing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes to song details?</AlertDialogTitle>
            <AlertDialogDescription>Your title and lyric edits will be discarded. Any unfinished project note will be kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <button type="button" className={button} onClick={discardDetails}>Discard detail edits</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {section === 'Overview' && (
        <section data-reveal className={`${panel} p-5 sm:p-6`}>
          {editing ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void act(
                  () => updateMusicProject(song.id, title, lyrics),
                  'Project details saved.',
                ).then((saved) => {
                  if (saved) setEditing(false);
                });
              }}
            >
              <label className="grid gap-2 text-[14px]">
                Song title
                <input
                  className={input}
                  value={title}
                  maxLength={160}
                  required
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="grid gap-2 text-[14px]">
                Lyrics and reference notes
                <textarea
                  className={`${input} min-h-[220px]`}
                  value={lyrics}
                  maxLength={20000}
                  disabled={busy}
                  onChange={(e) => setLyrics(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <button className={primary} disabled={busy}>
                  <Save className="size-4" /> Save details
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => detailsDirty ? setCancelEditing(true) : discardDetails()}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <h2 className="text-[20px] font-semibold">
                Lyrics and reference notes
              </h2>
              <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-muted-foreground">
                {song.lyrics ||
                  'No lyrics yet. Use Edit details to add lyrics, hook ideas, or reference notes.'}
              </p>
              <div className="mt-6 pt-5 border-t border-border flex flex-wrap gap-3">
                <button
                  className={button}
                  onClick={() => setSection('Contracts')}
                >
                  <FileText className="size-4" /> View contracts
                </button>
                <Link className={primary} to={createUrl}>
                  <Plus className="size-4" /> Create contract
                </Link>
              </div>
            </>
          )}
        </section>
      )}
      {section === 'Contracts' && (
        <section data-reveal className={`${panel} p-5 sm:p-6`}>
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div>
              <h2 className="text-[20px] font-semibold">
                Contracts for this song
              </h2>
              <p className="text-[14px] text-muted-foreground mt-1">
                Attach a saved agreement or create a draft for {song.title}.
              </p>
            </div>
            <Link to={createUrl} className={primary}>
              <Plus className="size-4" /> Create contract
            </Link>
          </div>
          <ErrorNotice>{contractError}</ErrorNotice>
          <form
            className="flex flex-col sm:flex-row gap-2 mt-5"
            onSubmit={(event) => {
              event.preventDefault();
              const selected = available.find(
                (contract) => contract.id === contractSelection,
              );
              if (!selected) return;
              void act(
                () =>
                  attachProjectContract(song.id, {
                    contractId: selected.filingDraftId || selected.id,
                    source: selected.filingDraftId ? 'filing' : 'account',
                    title: selected.title,
                    contractType: selected.contractType,
                  }),
                'Contract attached.',
              ).then((saved) => {
                if (saved) setContractSelection('');
              });
            }}
          >
            <label className="flex-1 min-w-0">
              <span className="sr-only">Existing contract</span>
              <select
                className={input}
                value={contractSelection}
                onChange={(e) => setContractSelection(e.target.value)}
                disabled={busy || contractsLoading || !available.length}
              >
                <option value="">
                  {contractsLoading
                    ? 'Loading contracts…'
                    : available.length
                      ? 'Choose an existing contract…'
                      : 'No unattached contracts available'}
                </option>
                {available.map((contract) => (
                  <option key={contract.id} value={contract.id}>
                    {contract.title}
                  </option>
                ))}
              </select>
            </label>
            <button className={button} disabled={busy || !contractSelection}>
              Attach existing contract
            </button>
          </form>
          <div className="grid gap-3 mt-5">
            {song.contracts.length ? (
              song.contracts.map((link) => {
                const current = contracts.find((contract) =>
                  link.draftId
                    ? contract.filingDraftId === link.draftId
                    : contract.id === link.accountContractId,
                );
                const href = link.draftId
                  ? savedContractEditorPath(link.draftId, song.id)
                  : `/dashboard/contracts/${link.accountContractId}`;
                return (
                  <div
                    key={link.id}
                    className="rounded-[16px] border border-border bg-muted p-4 flex flex-wrap justify-between items-center gap-3"
                  >
                    <div className="min-w-0">
                      <h3 className="font-semibold break-words">
                        {current?.title || link.title}
                      </h3>
                      <p className="text-[13px] text-muted-foreground">
                        {current?.contractType || link.contractType}
                      </p>
                      {current && <div className="mt-2"><ContractStageBadge status={current.status} /></div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link to={href} className={button}>
                        Open <ArrowRight className="size-4" />
                      </Link>
                      {link.draftId && (
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() => {
                            void (async () => {
                              setBusy(true);
                              setError('');
                              try {
                                await downloadFilingDraft(link.draftId!);
                              } catch (err) {
                                setError(message(err));
                              } finally {
                                setBusy(false);
                              }
                            })();
                          }}
                          aria-label={`Download ${link.title}`}
                        >
                          <Download className="size-4" />
                        </button>
                      )}
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => {
                          void act(
                            () => detachProjectContract(song.id, link.id),
                            'Contract detached. The original agreement is still saved.',
                          );
                        }}
                      >
                        Detach
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="rounded-[16px] border border-dashed border-border p-6 text-[14px] text-muted-foreground">
                No agreements attached yet. Keep the paperwork behind this song
                in one place.
              </p>
            )}
          </div>
        </section>
      )}
      {section === 'Notes' && (
        <section data-reveal className={`${panel} p-5 sm:p-6`}>
          <h2 className="text-[20px] font-semibold">Project notes</h2>
          <p className="text-[14px] text-muted-foreground mt-1">
            Keep your feedback and next steps beside the song.
          </p>
          <form
            className="grid gap-3 mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void act(() => addProjectNote(song.id, note), 'Note saved.').then(
                (saved) => {
                  if (saved) setNote('');
                },
              );
            }}
          >
            <label>
              <span className="sr-only">New project note</span>
              <textarea
                className={`${input} min-h-[90px]`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Leave a note on the track…"
                maxLength={5000}
                required
                disabled={busy || Boolean(recovery.copy)}
              />
            </label>
            <button
              className={`${primary} justify-self-start`}
              disabled={busy || Boolean(recovery.copy) || !note.trim()}
            >
              <MessageSquare className="size-4" /> Add note
            </button>
          </form>
          <div className="grid gap-3 mt-5">
            {song.comments.length ? (
              song.comments.map((comment) => (
                <article
                  key={comment.id}
                  className="rounded-[16px] border border-border bg-muted p-4"
                >
                  <p className="text-[12px] text-muted-foreground mb-2">
                    {date(comment.createdAt)}
                  </p>
                  <p className="text-[14px] whitespace-pre-wrap break-words">
                    {comment.body}
                  </p>
                </article>
              ))
            ) : (
              <p className="text-[14px] text-muted-foreground">No notes yet.</p>
            )}
          </div>
        </section>
      )}
      <div className="flex justify-end">
        <button
          className={`${button} text-red-700 dark:text-red-200`}
          disabled={busy}
          onClick={() => {
            if (
              !window.confirm(
                `Delete “${song.title}” and its audio and notes? Attached contracts will stay in your contract library.`,
              )
            )
              return;
            setBusy(true);
            setError('');
            void deleteMusicProject(song.id)
              .then(() => {
                recovery.clear();
                setEditing(false);
                setNote('');
                setBusy(false);
                const leaving = markClean();
                if (!leaving) navigate('/dashboard');
              })
              .catch((err) => {
                setError(message(err));
                setBusy(false);
              });
          }}
        >
          <Trash2 className="size-4" /> Delete project
        </button>
      </div>
    </main>
  );
}
