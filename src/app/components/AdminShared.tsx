import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { Page, SupportTicket } from '../data/adminClient';
import { useLeaveConfirmation } from './UnsavedChanges';

export const adminPanel = 'min-w-0 rounded-[22px] border border-border bg-card p-4 sm:p-6';
export const adminInput = 'w-full min-w-0 rounded-[12px] border border-border bg-muted px-3 py-2.5 text-[14px] text-foreground focus:outline-none focus:border-primary disabled:opacity-60';
export const adminButton = 'micro-interaction inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-border bg-muted px-4 py-2.5 text-[14px] font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60';
export const adminPrimary = `${adminButton} bg-primary text-primary-foreground hover:opacity-90`;
export const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Never';
export const statusLabel = (value: string) => value.replace(/_/g, ' ');

export function useRemote<T>(key: string, fetcher: () => Promise<T>) {
  const fetchRef = useRef(fetcher); fetchRef.current = fetcher;
  const [state, setState] = useState<{ key: string; data?: T; error: string; loading: boolean }>({ key, error: '', loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    setState(current => ({ key, data: current.key === key ? current.data : undefined, error: '', loading: true }));
    void fetchRef.current().then(data => { if (active) setState({ key, data, loading: false, error: '' }); })
      .catch(error => { if (active) setState({ key, loading: false, error: error instanceof Error ? error.message : 'This information could not be loaded.' }); });
    return () => { active = false; };
  }, [key, revision]);
  return { data: state.key === key ? state.data : undefined, error: state.key === key ? state.error : '', loading: state.key !== key || state.loading, reload };
}

export function RemoteState({ loading, error, retry, children }: { loading: boolean; error: string; retry: () => void; children: ReactNode }) {
  if (error) return <div className={adminPanel}><p role="alert" className="text-sm text-destructive">{error}</p><button type="button" className={`${adminButton} mt-3`} onClick={retry}>Try again</button></div>;
  if (loading) return <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</p>;
  return <>{children}</>;
}

export function Pagination({ result, page, setPage }: { result?: Pick<Page<unknown>, 'total' | 'pageSize'>; page: number; setPage: (page: number) => void }) {
  if (!result) return null;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
    <p role="status">{result.total} results · Page {page} of {pages}</p>
    <div className="flex gap-2"><button type="button" className={adminButton} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className={adminButton} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
  </div>;
}

export function SaveError({ error, reload }: { error: string; reload: () => void }) {
  const requestLeave = useLeaveConfirmation();
  if (!error) return null;
  return <div><p role="alert" className="text-sm text-destructive">{error}</p><button type="button" className={`${adminButton} mt-3`} onClick={() => requestLeave(reload)}>Reload latest details</button></div>;
}

export function TicketConversation({ ticket }: { ticket: SupportTicket }) {
  return <div className="grid gap-3" aria-label="Request conversation">
    <article className="rounded-[14px] border border-border p-4"><p className="mb-2 text-xs text-muted-foreground">Original request · {dateLabel(ticket.createdAt)}</p><p className="whitespace-pre-wrap break-words text-sm">{ticket.message}</p></article>
    {ticket.replies?.map(reply => <article key={reply.id} className={`rounded-[14px] border p-4 ${reply.isInternal ? 'border-amber-500/40 bg-amber-500/5' : 'border-border'}`}>
      <p className="mb-2 text-xs font-semibold">{reply.authorName} {reply.isInternal ? '· Internal note' : reply.isStaff ? '· Support team' : '· Member'} <span className="font-normal text-muted-foreground">· {dateLabel(reply.createdAt)}</span></p>
      <p className="whitespace-pre-wrap break-words text-sm">{reply.body}</p>
    </article>)}
  </div>;
}
