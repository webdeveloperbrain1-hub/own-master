import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Loader2, ShieldCheck, Upload } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { adminSections as tabs, adminUrl, selectedAdminSection } from '../data/adminNavigation';
import { useUnsavedChanges } from '../components/UnsavedChanges';
import { fetchAdmin, updateAdmin, type Activity, type AdminDocument, type AdminSummary, type AdminUser, type Page, type SupportTicket, type TicketStatus } from '../data/adminClient';
import { downloadFilingOriginal, uploadFilingTemplate } from '../data/contractFilingClient';
import { adminButton as button, adminInput as input, adminPanel as panel, adminPrimary as primary, dateLabel, Pagination, RemoteState, SaveError, statusLabel, TicketConversation, useRemote } from '../components/AdminShared';

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The change could not be saved.';

export default function AdminPage() {
  const { user, isAdmin } = useAuth();
  const [params] = useSearchParams();
  if (!user || !isAdmin) return <Navigate to="/dashboard" replace />;
  const tab = selectedAdminSection(params.get('tab'));
  const item = params.get('item');
  return <main className="grid min-w-0 gap-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground"><ShieldCheck className="size-4" />Website administration</p><h1 className="text-[30px] font-bold tracking-tight sm:text-[36px]">Admin workspace</h1><p className="mt-2 text-sm text-muted-foreground">Your library administrator account manages the whole website: users, library documents, support, reports, and activity. All workspace features are included.</p></div>
      <Link to="/dashboard/account" className={button}>My account</Link>
    </header>
    <nav aria-label="Admin sections" className="flex flex-wrap gap-2">{tabs.map(([key, label]) => <Link key={key} to={adminUrl(key)} aria-current={tab === key ? 'page' : undefined} className={tab === key ? primary : button}>{label}</Link>)}</nav>
    {tab === 'overview' && <Overview />}
    {tab === 'users' && <Users key="users" item={item} actorId={user.id} />}
    {tab === 'library' && <Library key="library" item={item} />}
    {tab === 'tickets' && <Tickets key="tickets" item={item} />}
    {tab === 'activity' && <ActivityList />}
  </main>;
}

function Overview() {
  const result = useRemote('admin-summary', () => fetchAdmin<AdminSummary>('summary'));
  const [metric, setMetric] = useState<'users' | 'projects' | 'contracts' | 'tickets'>('users');
  const labels = { users: 'New accounts', projects: 'New projects', contracts: 'New contracts', tickets: 'New requests' };
  const cards = result.data ? [
    ['Accounts', result.data.totals.users], ['Active accounts · 30 days', result.data.totals.activeUsers],
    ['Suspended accounts', result.data.totals.suspendedUsers], ['Active administrators', result.data.totals.admins],
    ['Library documents', result.data.totals.documents], ['Documents needing review', result.data.totals.needsReview],
    ['Song projects', result.data.totals.projects], ['Saved contracts', result.data.totals.contracts],
    ['Signed copies', result.data.totals.signedCopies], ['Open support & reports', result.data.totals.openTickets],
  ] : [];
  const max = Math.max(1, ...(result.data?.daily.map(day => day[metric]) || []));
  return <RemoteState {...result} retry={result.reload}>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{cards.map(([label, count]) => <section className={panel} key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-[28px] font-bold">{Number(count).toLocaleString()}</p></section>)}</div>
    <section className={panel}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Activity over 14 days</h2><p className="mt-1 text-xs text-muted-foreground">Daily totals in UTC. Active accounts have used the workspace within 30 days.</p></div><select aria-label="Activity metric" className={`${input} sm:!w-auto`} value={metric} onChange={event => setMetric(event.target.value as typeof metric)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div role="img" aria-label={`${labels[metric]} over the last 14 days`} className="flex h-44 items-end gap-1 sm:gap-2">
        {result.data?.daily.map(day => <div key={day.day} title={`${day.day}: ${day[metric]}`} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1 text-center"><span className="text-[10px] text-muted-foreground">{day[metric]}</span><div className="min-h-1 rounded-t-md bg-primary/75" style={{ height: `${Math.max(1, day[metric] / max * 75)}%` }} /><span className="text-[9px] text-muted-foreground">{day.day.slice(8)}</span></div>)}
      </div>
      <details className="mt-5 text-sm"><summary className="cursor-pointer font-semibold">View daily totals</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Date (UTC)', 'Accounts', 'Projects', 'Contracts', 'Requests'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{result.data?.daily.map(day => <tr key={day.day}><td className="p-2">{day.day}</td>{(['users', 'projects', 'contracts', 'tickets'] as const).map(key => <td className="p-2" key={key}>{day[key]}</td>)}</tr>)}</tbody></table></div></details>
    </section>
    <div className="flex flex-wrap gap-3"><Link className={button} to={adminUrl('library')}>Review library</Link><Link className={button} to={adminUrl('tickets')}>Open support queue</Link><Link className={button} to={adminUrl('activity')}>View activity log</Link></div>
  </RemoteState>;
}

function useList<T>(endpoint: string, initialStatus = '', extra: Record<string, string> = {}) {
  const [q, setQ] = useState(''); const [page, setPage] = useState(1); const [status, setStatus] = useState(initialStatus);
  const key = `${endpoint}?${new URLSearchParams({ q, page: String(page), status, ...extra })}`;
  const remote = useRemote(key, () => fetchAdmin<Page<T>>(key));
  return { ...remote, q, page, status, setPage, search: (value: string) => { setQ(value); setPage(1); }, filter: (value: string) => { setStatus(value); setPage(1); } };
}

function Users({ item, actorId }: { item: string | null; actorId: string }) {
  const [roleFilter, setRoleFilter] = useState('');
  const list = useList<AdminUser>('users', '', { role: roleFilter });
  return <>
    {item && <UserDetail key={item} id={item} actorId={actorId} onSaved={list.reload} />}
    <section className={panel}>
      <h2 className="mb-2 text-xl font-bold">Manage users</h2>
      <p className="mb-4 text-sm text-muted-foreground">Open an account to edit its display name, grant website administrator access, suspend it, or reactivate it.</p>
      <div className="mb-4 flex flex-wrap gap-3"><input aria-label="Search accounts" type="search" placeholder="Search name or email" className={`${input} sm:!w-80`} value={list.q} onChange={event => list.search(event.target.value)} /><select aria-label="Account filter" className={`${input} sm:!w-auto`} value={list.status} onChange={event => list.filter(event.target.value)}><option value="">All account statuses</option><option value="active">Active</option><option value="unconfirmed">Unconfirmed email</option><option value="suspended">Suspended</option></select><select aria-label="Account role filter" className={`${input} sm:!w-auto`} value={roleFilter} onChange={event => { setRoleFilter(event.target.value); list.setPage(1); }}><option value="">All roles</option><option value="admin">Administrators</option><option value="member">Members</option></select></div>
      <RemoteState {...list} retry={list.reload}><div className="grid gap-2">{list.data?.items.map(account => <Link to={adminUrl('users', account.id)} key={account.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border p-4 hover:bg-accent"><div className="min-w-0"><p className="break-words font-semibold">{account.name}</p><p className="break-all text-xs text-muted-foreground">{account.email}</p></div><span className="text-xs capitalize">{account.role} · {account.suspendedAt ? 'Suspended' : account.emailVerifiedAt ? 'Active' : 'Unconfirmed'}</span></Link>)}{list.data?.items.length === 0 && <p className="py-4 text-sm text-muted-foreground">No accounts match this search.</p>}</div><Pagination result={list.data} page={list.page} setPage={list.setPage} /></RemoteState>
    </section>
  </>;
}

function UserDetail({ id, actorId, onSaved }: { id: string; actorId: string; onSaved: () => void }) {
  const detail = useRemote(`user-${id}`, () => fetchAdmin<AdminUser>(`users/${id}`));
  return <RemoteState {...detail} retry={detail.reload}>{detail.data && <UserForm key={detail.data.updatedAt} account={detail.data} self={actorId === id} onSaved={() => { detail.reload(); onSaved(); }} />}</RemoteState>;
}

function UserForm({ account, self, onSaved }: { account: AdminUser; self: boolean; onSaved: () => void }) {
  const [name, setName] = useState(account.name);
  const [role, setRole] = useState(account.role); const [suspended, setSuspended] = useState(Boolean(account.suspendedAt)); const [reason, setReason] = useState(account.suspensionReason || '');
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const dirty = name.trim() !== account.name || role !== account.role || suspended !== Boolean(account.suspendedAt) || (suspended && reason !== (account.suspensionReason || ''));
  const markClean = useUnsavedChanges(dirty, busy);
  async function save() {
    setBusy(true); setError('');
    try { await updateAdmin(`users/${account.id}/update`, { name: name.trim(), role, suspended, reason, updatedAt: account.updatedAt }); markClean(); onSaved(); }
    catch (failure) { setError(messageOf(failure)); setConfirm(false); } finally { setBusy(false); }
  }
  return <section className={panel} aria-label="Manage account">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="break-all text-xl font-bold">{account.email}</h2><p className="mt-1 text-sm text-muted-foreground">Joined {dateLabel(account.createdAt)} · Last active {dateLabel(account.lastActiveAt)}</p></div><Link className={button} to={adminUrl('users')}>Close account details</Link></div>
    <p className="my-4 text-sm">{account.usage?.projects || 0} projects · {account.usage?.contracts || 0} contracts · {account.usage?.tickets || 0} support requests</p>
    {self && <p className="mb-4 text-sm text-muted-foreground">Your own administrator access cannot be removed here. Edit your profile in Account.</p>}
    <form onSubmit={event => { event.preventDefault(); setConfirm(true); }} className="grid max-w-xl gap-4">
      <label className="grid gap-2 text-sm font-semibold">Display name<input className={input} value={name} required maxLength={120} disabled={busy || self} onChange={event => { setName(event.target.value); setConfirm(false); }} /></label>
      <label className="grid gap-2 text-sm font-semibold">Role<select className={input} disabled={busy || self} value={role} onChange={event => { setRole(event.target.value as typeof role); setConfirm(false); }}><option value="member">Member</option><option value="admin" disabled={!account.emailVerifiedAt}>Administrator · Full access</option></select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={suspended} disabled={busy || self} onChange={event => { setSuspended(event.target.checked); setConfirm(false); }} />Suspend this account</label>
      {suspended && <label className="grid gap-2 text-sm font-semibold">Suspension reason<textarea className={input} value={reason} required maxLength={500} disabled={busy} onChange={event => { setReason(event.target.value); setConfirm(false); }} /></label>}
      <SaveError error={error} reload={onSaved} />
      {!confirm && <button type="submit" className={`${primary} justify-self-start`} disabled={busy || !dirty}>Review account changes</button>}
      {confirm && <div role="group" aria-label="Confirm account changes" className="rounded-[14px] border border-primary/40 p-4"><p className="text-sm">Save <strong>{name.trim()}</strong> for <strong>{account.email}</strong> with <strong>{role}</strong> and <strong>{suspended ? 'suspended' : 'active'}</strong> access? Administrator access includes every feature and account management. Access changes sign out existing sessions.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" autoFocus className={primary} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Confirm account changes'}</button><button type="button" className={button} disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div></div>}
    </form>
  </section>;
}

function Library({ item }: { item: string | null }) {
  const list = useList<AdminDocument>('library', 'active');
  const [uploading, setUploading] = useState(false); const [uploadError, setUploadError] = useState(''); const [uploaded, setUploaded] = useState<{ id: string; duplicate: boolean } | null>(null);
  async function upload(file: File) {
    setUploadError(''); setUploaded(null);
    if (file.size > 20 * 1024 * 1024) { setUploadError('Documents must be 20 MB or smaller.'); return; }
    setUploading(true);
    try { const result = await uploadFilingTemplate(file); setUploaded(result); list.reload(); }
    catch (error) { setUploadError(messageOf(error)); } finally { setUploading(false); }
  }
  return <>
    {item && <LibraryDetail key={item} id={item} onSaved={list.reload} />}
    <section className={panel}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Contracts & guides</h2><p className="mt-1 text-xs text-muted-foreground">Upload source documents, edit their library details, and record your review.</p></div><label className={`${primary} relative cursor-pointer`}>
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}{uploading ? 'Uploading…' : 'Upload document'}<input aria-label="Upload library document" className="absolute inset-0 cursor-pointer opacity-0" type="file" accept=".pdf,.doc,.docx,.rtf,.txt,.md" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label></div>
      <p className="mb-4 text-xs text-muted-foreground">PDF, DOC, DOCX, RTF, TXT, or MD · Up to 20 MB. Upload a revised source as a new document, then archive the older version.</p>
      {uploadError && <p role="alert" className="mb-3 text-sm text-destructive">{uploadError}</p>}
      {uploaded && <p role="status" className="mb-3 text-sm">{uploaded.duplicate ? 'This document already exists.' : 'Document uploaded.'} <Link className="underline" to={adminUrl('library', uploaded.id)}>Review document details</Link></p>}
      <div className="mb-4 flex flex-wrap gap-3"><input aria-label="Search library" type="search" className={`${input} sm:!w-80`} placeholder="Search title, file, or category" value={list.q} onChange={event => list.search(event.target.value)} /><select aria-label="Library filter" className={`${input} sm:!w-auto`} value={list.status} onChange={event => list.filter(event.target.value)}><option value="active">Active documents</option><option value="review">Needs review</option><option value="archived">Archived documents</option><option value="all">All documents</option></select></div>
      <RemoteState {...list} retry={list.reload}><div className="grid gap-2">{list.data?.items.map(document => <Link key={document.id} to={adminUrl('library', document.id)} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border p-4 hover:bg-accent"><div className="min-w-0"><p className="break-words font-semibold">{document.title}</p><p className="break-all text-xs text-muted-foreground">{document.originalName} · {document.category}</p></div><span className="text-xs capitalize">{document.kind} · {document.archivedAt ? 'Archived' : document.needsReview ? 'Needs review' : 'Reviewed'}</span></Link>)}{list.data?.items.length === 0 && <p className="py-4 text-sm text-muted-foreground">No documents match these filters.</p>}</div><Pagination result={list.data} page={list.page} setPage={list.setPage} /></RemoteState>
    </section>
  </>;
}

function LibraryDetail({ id, onSaved }: { id: string; onSaved: () => void }) {
  const detail = useRemote(`library-${id}`, () => fetchAdmin<AdminDocument>(`library/${id}`));
  return <RemoteState {...detail} retry={detail.reload}>{detail.data && <LibraryForm key={detail.data.version} document={detail.data} onSaved={() => { detail.reload(); onSaved(); }} />}</RemoteState>;
}

function LibraryForm({ document, onSaved }: { document: AdminDocument; onSaved: () => void }) {
  const initial = { title: document.title, category: document.category, description: document.description, kind: document.kind, reviewed: !document.needsReview, reviewNote: document.reviewNote };
  const [form, setForm] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirmArchive, setConfirmArchive] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const markClean = useUnsavedChanges(dirty, busy);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await updateAdmin(`library/${document.id}/update`, { ...form, version: document.version }); markClean(); onSaved(); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  async function archive() {
    setBusy(true); setError('');
    try { await updateAdmin(`library/${document.id}/archive`, { archived: !document.archivedAt, version: document.version }); markClean(); onSaved(); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  return <section className={panel} aria-label="Edit library document">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-xl font-bold">Library details</h2><p className="mt-1 break-all text-xs text-muted-foreground">{document.originalName} · {document.textLength.toLocaleString()} extracted characters · {statusLabel(document.extractionStatus)}</p></div><Link to={adminUrl('library')} className={button}>Close document details</Link></div>
    {document.archivedAt && <p className="mb-4 text-sm text-muted-foreground">Archived on {dateLabel(document.archivedAt)}. Existing saved drafts remain available.</p>}
    <button type="button" className={button} onClick={() => { void downloadFilingOriginal(document.id).catch(error => setError(messageOf(error))); }}>Download source document</button>
    <details className="my-4"><summary className="cursor-pointer text-sm font-semibold">Review extracted source text</summary><div className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[14px] border border-border p-4 text-sm">{document.text || 'No text could be extracted. Check the original document.'}</div>{document.extractionWarnings.map(warning => <p key={warning} className="mt-2 text-xs text-muted-foreground">{warning}</p>)}</details>
    <form onSubmit={event => void save(event)} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-semibold">Title<input className={input} value={form.title} required maxLength={160} disabled={busy} onChange={event => setForm({ ...form, title: event.target.value })} /></label><label className="grid gap-2 text-sm font-semibold">Category<input className={input} value={form.category} required maxLength={100} disabled={busy} onChange={event => setForm({ ...form, category: event.target.value })} /></label></div>
      <label className="grid gap-2 text-sm font-semibold">Library section<select className={input} value={form.kind} disabled={busy} onChange={event => setForm({ ...form, kind: event.target.value as typeof form.kind })}><option value="template">Contract template</option><option value="guide">Guide or resource</option></select></label>
      <label className="grid gap-2 text-sm font-semibold">Description<textarea rows={3} className={input} value={form.description} maxLength={2000} disabled={busy} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.reviewed} disabled={busy} onChange={event => setForm({ ...form, reviewed: event.target.checked })} />I have reviewed this document</label>
      <label className="grid gap-2 text-sm font-semibold">Internal review note<textarea className={input} value={form.reviewNote} maxLength={2000} disabled={busy} onChange={event => setForm({ ...form, reviewNote: event.target.value })} /></label>
      <SaveError error={error} reload={onSaved} />
      <button type="submit" className={`${primary} justify-self-start`} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save library details'}</button>
    </form>
    <div className="mt-6 border-t border-border pt-5"><p className="mb-3 text-sm text-muted-foreground">{document.draftCount} saved drafts use this source. Archiving removes it from the shared library and preserves existing drafts.</p>
      {!confirmArchive && <button type="button" className={button} disabled={busy || dirty} onClick={() => document.archivedAt ? void archive() : setConfirmArchive(true)}>{document.archivedAt ? 'Restore to library' : 'Remove from library'}</button>}
      {dirty && <p className="mt-2 text-xs text-muted-foreground">Save your edits before changing document availability.</p>}
      {confirmArchive && <div role="group" aria-label="Confirm library removal" className="rounded-[14px] border border-border p-4"><p className="text-sm">Archive this document and remove it from the shared library? You can restore it later.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" autoFocus className={primary} disabled={busy} onClick={() => void archive()}>Confirm removal</button><button type="button" className={button} disabled={busy} onClick={() => setConfirmArchive(false)}>Cancel</button></div></div>}
    </div>
  </section>;
}

function Tickets({ item }: { item: string | null }) {
  const [kind, setKind] = useState('');
  const list = useList<SupportTicket>('tickets', '', { kind });
  return <>
    {item && <TicketDetail key={item} id={item} onSaved={list.reload} />}
    <section className={panel}><div className="mb-4 flex flex-wrap gap-3"><input aria-label="Search requests" type="search" className={`${input} sm:!w-80`} value={list.q} placeholder="Search subject or member email" onChange={event => list.search(event.target.value)} /><select aria-label="Request filter" className={`${input} sm:!w-auto`} value={list.status} onChange={event => list.filter(event.target.value)}><option value="">All statuses</option>{['open', 'in_progress', 'resolved', 'dismissed'].map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select><select aria-label="Request type filter" className={`${input} sm:!w-auto`} value={kind} onChange={event => { setKind(event.target.value); list.setPage(1); }}><option value="">Support & reports</option><option value="support">Support requests</option><option value="report">Content reports</option></select></div>
      <RemoteState {...list} retry={list.reload}><div className="grid gap-2">{list.data?.items.map(ticket => <Link to={adminUrl('tickets', ticket.id)} key={ticket.id} className="rounded-[14px] border border-border p-4 hover:bg-accent"><div className="flex flex-wrap justify-between gap-2"><p className="break-words font-semibold">{ticket.subject}</p><span className="text-xs capitalize">{ticket.kind} · {statusLabel(ticket.status)}{ticket.priority === 'high' ? ' · High priority' : ''}</span></div><p className="mt-1 break-all text-xs text-muted-foreground">{ticket.user?.email} · {dateLabel(ticket.updatedAt)}</p></Link>)}{list.data?.items.length === 0 && <p className="py-4 text-sm text-muted-foreground">No support requests or reports match these filters.</p>}</div><Pagination result={list.data} page={list.page} setPage={list.setPage} /></RemoteState>
    </section>
  </>;
}

function TicketDetail({ id, onSaved }: { id: string; onSaved: () => void }) {
  const detail = useRemote(`ticket-${id}`, () => fetchAdmin<SupportTicket>(`tickets/${id}`));
  return <RemoteState {...detail} retry={detail.reload}>{detail.data && <TicketForm key={detail.data.version} ticket={detail.data} onSaved={() => { detail.reload(); onSaved(); }} />}</RemoteState>;
}

function TicketForm({ ticket, onSaved }: { ticket: SupportTicket; onSaved: () => void }) {
  const [status, setStatus] = useState(ticket.status); const [priority, setPriority] = useState(ticket.priority); const [response, setResponse] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const dirty = status !== ticket.status || priority !== ticket.priority || Boolean(response.trim() || note.trim());
  const markClean = useUnsavedChanges(dirty, busy);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await updateAdmin(`tickets/${ticket.id}/update`, { status, priority, response, note, version: ticket.version }); markClean(); onSaved(); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  return <section className={`${panel} grid gap-4`} aria-label="Manage support request">
    <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-xl font-bold">{ticket.subject}</h2><p className="mt-1 break-all text-xs text-muted-foreground">{ticket.user?.name} · {ticket.user?.email}</p></div><Link className={button} to={adminUrl('tickets')}>Close request</Link></div>
    {ticket.targetId && <p className="text-sm">Reported document: <Link className="underline" to={adminUrl('library', ticket.targetId)}>{ticket.targetTitle || 'Open library document'}</Link></p>}
    <TicketConversation ticket={ticket} />
    <form onSubmit={event => void save(event)} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-semibold">Request status<select className={input} value={status} disabled={busy} onChange={event => setStatus(event.target.value as TicketStatus)}>{['open', 'in_progress', 'resolved', 'dismissed'].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label><label className="grid gap-2 text-sm font-semibold">Priority<select className={input} value={priority} disabled={busy} onChange={event => setPriority(event.target.value as typeof priority)}><option value="normal">Normal</option><option value="high">High</option></select></label></div>
      <label className="grid gap-2 text-sm font-semibold">Reply to member<textarea className={input} rows={4} value={response} maxLength={5000} disabled={busy} onChange={event => setResponse(event.target.value)} /><span className="text-xs font-normal text-muted-foreground">The member will see this reply in Support. No email is sent.</span></label>
      <label className="grid gap-2 text-sm font-semibold">Internal staff note<textarea className={input} rows={3} value={note} maxLength={5000} disabled={busy} onChange={event => setNote(event.target.value)} /><span className="text-xs font-normal text-muted-foreground">Visible only to administrators.</span></label>
      <SaveError error={error} reload={onSaved} />
      <button type="submit" className={`${primary} justify-self-start`} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save request & replies'}</button>
    </form>
  </section>;
}

function ActivityList() {
  const list = useList<Activity>('activity');
  return <section className={panel}><h2 className="mb-2 text-xl font-bold">Platform activity</h2><p className="mb-4 text-sm text-muted-foreground">Account sign-ins, profile and password changes, library actions, role changes, and support activity. Credentials and message contents are excluded.</p><input aria-label="Search activity" className={`${input} mb-4 sm:!w-96`} type="search" value={list.q} placeholder="Search actor, event, or description" onChange={event => list.search(event.target.value)} />
    <RemoteState {...list} retry={list.reload}><ol className="grid gap-3">{list.data?.items.map(event => <li key={event.id} className="rounded-[14px] border border-border p-4"><div className="flex flex-wrap justify-between gap-2"><p className="break-words text-sm font-semibold">{event.actorName} · <span className="font-normal">{event.action}</span></p><time className="text-xs text-muted-foreground">{dateLabel(event.createdAt)}</time></div><p className="mt-2 break-words text-sm text-muted-foreground">{event.description}</p></li>)}</ol>{list.data?.items.length === 0 && <p className="py-4 text-sm text-muted-foreground">No activity matches this search.</p>}<Pagination result={list.data} page={list.page} setPage={list.setPage} /></RemoteState>
  </section>;
}
