import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Download,
  FileCheck2,
  Loader2,
  Save,
  Upload,
} from 'lucide-react';
import {
  changeContractStage,
  downloadSignedCopy,
  fetchContractProgress,
  uploadSignedCopy,
} from '../data/contractProgressClient';
import {
  CONTRACT_PROGRESS_LABELS,
  contractStageLabel,
  type ContractProgressSource,
  type ContractProgressStage,
  type ContractProgressView,
} from '../data/contractProgressTypes';

const button =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-border bg-muted px-3.5 py-2.5 text-[13px] font-semibold hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed';
const input =
  'w-full min-w-0 rounded-[12px] border border-border bg-input px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Could not update contract progress. Please try again.';
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function ContractStageBadge({ status }: { status: string }) {
  const tone =
    status === 'signed'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
      : status === 'cancelled'
        ? 'border-border bg-muted text-muted-foreground'
        : status === 'awaiting_signatures'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
          : status === 'ready_for_review'
            ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-200'
            : 'border-border bg-card text-muted-foreground';
  return (
    <span
      className={`inline-flex w-max shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] font-semibold ${tone}`}
    >
      {status === 'signed' && <CheckCircle2 className="size-3.5 shrink-0" />}
      {contractStageLabel(status)}
    </span>
  );
}

export function ContractProgressPanel({
  source,
  contractId,
  disabled = false,
  onChange,
}: {
  source: ContractProgressSource;
  contractId: string;
  disabled?: boolean;
  onChange?: (value: ContractProgressView) => void;
}) {
  const [progress, setProgress] = useState<ContractProgressView | null>(null);
  const [stage, setStage] = useState<ContractProgressStage>('draft');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setProgress(null);
    setError('');
    setNotice('');
    setNote('');
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
    void fetchContractProgress(source, contractId)
      .then((value) => {
        if (active) {
          setProgress(value);
          setStage(value.status);
          changeRef.current?.(value);
        }
      })
      .catch((err) => {
        if (active) setError(errorText(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [source, contractId, retry]);

  async function act(
    operation: () => Promise<ContractProgressView>,
    success: string,
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await operation();
      setProgress(value);
      setStage(value.status);
      setNote('');
      changeRef.current?.(value);
      setNotice(success);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-reveal
      className="border border-border bg-card rounded-[22px] p-4 sm:p-5"
      aria-label="Contract progress"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[20px] font-semibold">
            <Clock3 className="size-5" /> Contract progress
          </h2>
          <p className="text-[13px] text-muted-foreground mt-1">
            Track the stage yourself and keep your signed copies here.
          </p>
        </div>
        {progress && <ContractStageBadge status={progress.status} />}
      </div>
      {loading ? (
        <p
          role="status"
          className="mt-4 text-muted-foreground flex gap-2 items-center"
        >
          <Loader2 className="size-4 animate-spin" /> Loading progress…
        </p>
      ) : (
        <>
          {error && (
            <div
              role="alert"
              className="mt-4 rounded-[12px] border border-destructive/40 bg-destructive/10 p-3 text-[13px] text-red-700 dark:text-red-200"
            >
              <p>{error}</p>
              <button
                type="button"
                className={`${button} mt-2`}
                disabled={busy}
                onClick={() => setRetry((value) => value + 1)}
              >
                Reload progress
              </button>
            </div>
          )}
          {notice && (
            <p role="status" className="mt-3 text-[13px] text-muted-foreground">
              {notice}
            </p>
          )}
          {progress && (
            <>
              {!progress.tracked && progress.previousStatus === 'completed' && (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Previous status: completed. Choose a stage to begin tracking;
                  an uploaded signed PDF is required for Signed.
                </p>
              )}
              {disabled && (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Save your draft edits before changing its progress.
                </p>
              )}
              <form
                className="grid gap-3 mt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(
                    () =>
                      changeContractStage(
                        source,
                        contractId,
                        stage,
                        progress.version,
                        note,
                      ),
                    'Contract stage saved.',
                  );
                }}
              >
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <label className="grid gap-1.5 text-[13px] flex-1">
                    Stage
                    <select
                      className={input}
                      value={stage}
                      disabled={busy || disabled}
                      onChange={(event) =>
                        setStage(event.target.value as ContractProgressStage)
                      }
                    >
                      {Object.entries(CONTRACT_PROGRESS_LABELS).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <button
                    className={button}
                    disabled={
                      busy ||
                      disabled ||
                      (progress.tracked && stage === progress.status) ||
                      (stage === 'signed' && !progress.signedCopies.length)
                    }
                  >
                    <Save className="size-4" /> Save stage
                  </button>
                </div>
                <label className="grid gap-1.5 text-[13px]">
                  Status note (optional)
                  <input
                    className={input}
                    maxLength={1000}
                    value={note}
                    disabled={busy || disabled}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="For example: sent to the producer for review"
                  />
                </label>
                {stage === 'signed' && !progress.signedCopies.length && (
                  <p className="text-[13px] text-muted-foreground">
                    Upload the signed PDF below to mark this contract signed.
                  </p>
                )}
              </form>
              <div className="mt-5 pt-4 border-t border-border">
                <h3 className="flex gap-2 items-center text-[15px] font-semibold">
                  <FileCheck2 className="size-4" /> Signed copies
                </h3>
                <p className="text-[12px] text-muted-foreground mt-1">
                  Keep the PDF you consider signed. Uploading marks the stage
                  Signed; it does not verify signatures. These files stay
                  separate from the editable draft.
                </p>
                <form
                  className="grid gap-2 mt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!file) return;
                    void act(
                      () =>
                        uploadSignedCopy(
                          source,
                          contractId,
                          file,
                          progress.version,
                        ),
                      'Signed copy saved and contract marked Signed.',
                    ).then((saved) => {
                      if (saved) {
                        setFile(null);
                        if (fileInput.current) fileInput.current.value = '';
                      }
                    });
                  }}
                >
                  <label className="grid gap-1.5 text-[13px]">
                    Signed PDF (up to 20 MB)
                    <input
                      ref={fileInput}
                      className={`${input} file:mr-2 file:text-foreground`}
                      type="file"
                      accept=".pdf,application/pdf"
                      disabled={busy || disabled}
                      onChange={(event) =>
                        setFile(event.target.files?.[0] || null)
                      }
                    />
                  </label>
                  <button
                    className={`${button} justify-self-start`}
                    disabled={busy || disabled || !file}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}{' '}
                    Upload &amp; mark signed
                  </button>
                </form>
                <ul className="grid gap-2 mt-3">
                  {progress.signedCopies.map((copy) => (
                    <li
                      key={copy.id}
                      className="rounded-[12px] border border-border bg-muted p-3 flex flex-wrap justify-between items-center gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold break-all">
                          {copy.fileName}
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          {date(copy.uploadedAt)} ·{' '}
                          {copy.sizeBytes < 1024 * 1024 ? `${Math.max(1, Math.round(copy.sizeBytes / 1024))} KB` : `${(copy.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
                        </p>
                      </div>
                      <button
                        className={button}
                        disabled={busy}
                        aria-label={`Download signed copy ${copy.fileName}`}
                        onClick={() => {
                          setBusy(true);
                          setError('');
                          void downloadSignedCopy(source, contractId, copy.id)
                            .catch((err) => setError(errorText(err)))
                            .finally(() => setBusy(false));
                        }}
                      >
                        <Download className="size-4" /> Download
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <details className="mt-4 border-t border-border pt-4">
                <summary className="text-[14px] font-semibold cursor-pointer">
                  Activity history ({progress.events.length})
                </summary>
                {progress.events.length ? (
                  <ol className="grid gap-3 mt-3">
                    {progress.events.map((event) => (
                      <li
                        key={event.id}
                        className="border-l-2 border-border pl-3"
                      >
                        <p className="text-[13px] font-semibold">
                          {event.action === 'signed_copy_uploaded'
                            ? 'Signed copy uploaded'
                            : event.fromStatus
                              ? `${contractStageLabel(event.fromStatus)} → ${contractStageLabel(event.toStatus)}`
                              : `Marked ${contractStageLabel(event.toStatus)}`}
                        </p>
                        <p className="text-[12px] text-muted-foreground mt-1">
                          {date(event.createdAt)} · {event.actorName}
                        </p>
                        {event.note && (
                          <p className="text-[13px] mt-1 break-words whitespace-pre-wrap">
                            {event.note}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-[13px] text-muted-foreground">
                    No stage changes yet. Your changes will appear here with
                    their dates.
                  </p>
                )}
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
