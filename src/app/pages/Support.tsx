import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { useUnsavedChanges } from '../components/UnsavedChanges';
import { createSupportTicket, fetchSupport, replySupportTicket, type Page, type SupportTicket } from '../data/adminClient';
import { adminButton as button, adminInput as input, adminPanel as panel, adminPrimary as primary, dateLabel, Pagination, RemoteState, statusLabel, TicketConversation, useRemote } from '../components/AdminShared';

export default function SupportPage() {
  const { user } = useAuth();
  return user ? <SupportWorkspace key={user.id} /> : null;
}

function SupportWorkspace() {
  const [params] = useSearchParams(); const navigate = useNavigate();
  const id = params.get('ticket'); const documentId = params.get('document'); const documentTitle = params.get('title');
  const [page, setPage] = useState(1);
  const list = useRemote(`support-${page}`, () => fetchSupport<Page<SupportTicket>>(`?page=${page}`));
  function created(ticket: SupportTicket) { list.reload(); navigate(`/dashboard/support?ticket=${encodeURIComponent(ticket.id)}`); }
  return <main className="grid min-w-0 max-w-[1000px] gap-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="mb-2 text-xs uppercase tracking-[0.15em] text-muted-foreground">Help & feedback</p><h1 className="text-[30px] font-bold sm:text-[36px]">Support & reports</h1><p className="mt-2 text-sm text-muted-foreground">Ask for help or report a problem. Replies from the support team appear here.</p></div>{id && <Link to="/dashboard/support" className={button}>New request</Link>}</header>
    {id ? <RequestDetail key={id} id={id} onSaved={list.reload} /> : <NewRequest key={`${documentId}:${params.get('kind')}`} documentId={documentId} documentTitle={documentTitle} report={params.get('kind') === 'report' || Boolean(documentId)} onCreated={created} />}
    <section className={panel}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Your requests</h2><button type="button" className={button} disabled={list.loading} onClick={list.reload}>Refresh requests</button></div>
      <RemoteState {...list} retry={list.reload}><div className="grid gap-2">{list.data?.items.map(ticket => <Link key={ticket.id} to={`/dashboard/support?ticket=${encodeURIComponent(ticket.id)}`} className="rounded-[14px] border border-border p-4 hover:bg-accent"><div className="flex flex-wrap justify-between gap-2"><p className="break-words font-semibold">{ticket.subject}</p><span className="text-xs capitalize">{ticket.kind} · {statusLabel(ticket.status)}</span></div><p className="mt-1 text-xs text-muted-foreground">Updated {dateLabel(ticket.updatedAt)}</p></Link>)}{list.data?.items.length === 0 && <p className="py-4 text-sm text-muted-foreground">You have no requests yet.</p>}</div><Pagination result={list.data} page={page} setPage={setPage} /></RemoteState>
    </section>
  </main>;
}

function NewRequest({ documentId, documentTitle, report, onCreated }: { documentId: string | null; documentTitle: string | null; report: boolean; onCreated: (ticket: SupportTicket) => void }) {
  const initialKind = report ? 'report' : 'support'; const initialSubject = documentId ? `Issue with ${documentTitle || 'a library document'}`.slice(0, 160) : '';
  const [kind, setKind] = useState(initialKind); const [subject, setSubject] = useState(initialSubject); const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const markClean = useUnsavedChanges(Boolean(message || subject !== initialSubject || kind !== initialKind), busy);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const ticket = await createSupportTicket({ kind, subject: subject.trim(), message: message.trim(), ...(documentId && kind === 'report' ? { targetId: documentId } : {}) });
      markClean(); onCreated(ticket);
    } catch (error) { setError(error instanceof Error ? error.message : 'Your request could not be submitted.'); }
    finally { setBusy(false); }
  }
  return <form className={`${panel} grid gap-4`} onSubmit={event => void submit(event)} aria-label="New support request">
    <h2 className="text-xl font-bold">{kind === 'report' ? 'Report a problem' : 'Contact support'}</h2>
    <label className="grid gap-2 text-sm font-semibold">Request type<select className={input} value={kind} disabled={busy} onChange={event => setKind(event.target.value)}><option value="support">Support request</option><option value="report">Content or document report</option></select></label>
    {documentId && kind === 'report' && <p className="text-sm text-muted-foreground">Reporting: {documentTitle || 'Selected library document'}</p>}
    <label className="grid gap-2 text-sm font-semibold">Subject<input className={input} value={subject} required maxLength={160} disabled={busy} onChange={event => setSubject(event.target.value)} /></label>
    <label className="grid gap-2 text-sm font-semibold">Message<textarea className={input} rows={5} value={message} required maxLength={5000} disabled={busy} onChange={event => setMessage(event.target.value)} /></label>
    <p className="text-xs text-muted-foreground">Your message is shared with administrators. Include the steps and problem you encountered. Keep passwords, payment details, and account recovery links out of your message.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button type="submit" className={`${primary} justify-self-start`} disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
  </form>;
}

function RequestDetail({ id, onSaved }: { id: string; onSaved: () => void }) {
  const detail = useRemote(`support-ticket-${id}`, () => fetchSupport<SupportTicket>(`/${id}`));
  return <RemoteState {...detail} retry={detail.reload}>{detail.data && <RequestThread key={detail.data.version} ticket={detail.data} onSaved={() => { detail.reload(); onSaved(); }} />}</RemoteState>;
}

function RequestThread({ ticket, onSaved }: { ticket: SupportTicket; onSaved: () => void }) {
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const markClean = useUnsavedChanges(Boolean(message), busy);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await replySupportTicket(ticket.id, message.trim()); markClean(); onSaved(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Your reply could not be sent.'); } finally { setBusy(false); }
  }
  return <section className={`${panel} grid gap-4`} aria-label="Your support request"><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="break-words text-xl font-bold">{ticket.subject}</h2><span className="text-sm capitalize">{statusLabel(ticket.status)}</span></div>
    {ticket.targetTitle && <p className="text-sm text-muted-foreground">Reported document: {ticket.targetTitle}</p>}
    <TicketConversation ticket={ticket} />
    <form className="grid gap-3" onSubmit={event => void submit(event)} aria-label="Reply to support"><label className="grid gap-2 text-sm font-semibold">Your reply<textarea className={input} rows={4} value={message} required maxLength={5000} disabled={busy} onChange={event => setMessage(event.target.value)} /></label>
      {['resolved', 'dismissed'].includes(ticket.status) && <p className="text-xs text-muted-foreground">Sending a reply reopens this request.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button type="submit" className={`${primary} justify-self-start`} disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send reply'}</button>
    </form>
  </section>;
}
