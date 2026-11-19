import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import * as React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://music.example.com', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'])
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name as keyof typeof dom.window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, 'matchMedia', { configurable: true, value: (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }) });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router');
await mkdir(resolve('.codex'), { recursive: true });
const bundlePath = resolve(`.codex/admin-browser-tests-${process.pid}.mjs`);
const bundle = await build({ stdin: { contents: `
  export { AuthProvider, useAuth } from './src/app/auth/AuthContext';
  export { UnsavedChangesProvider } from './src/app/components/UnsavedChanges';
  export { BillingProvider } from './src/app/billing/BillingContext';
  export { default as DashboardLayout } from './src/app/components/DashboardLayout';
  export { default as AdminPage } from './src/app/pages/Admin';
  export { default as SupportPage } from './src/app/pages/Support';
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_API_BASE_URL: '' }) } });
await writeFile(bundlePath, bundle.outputFiles[0].contents);
after(async () => { await unlink(bundlePath); dom.window.close(); });
const { AuthProvider, useAuth, UnsavedChangesProvider, BillingProvider, DashboardLayout, AdminPage, SupportPage } = await import(pathToFileURL(bundlePath).href);
const flush = async () => { await setImmediate(); await setImmediate(); };

async function setup(path = '/dashboard/admin', role = 'admin', billingUnavailable = false) {
  const now = '2026-11-13T10:00:00.000Z';
  const actor = { id: 'actor', email: 'owner@example.test', user_metadata: { name: 'Owner' }, app_metadata: { role } };
  let account = { id: 'member-one', name: 'Member One', email: 'member@example.test', role: 'member', emailVerifiedAt: now, suspendedAt: null, suspensionReason: null, lastActiveAt: now, lastLoginAt: now, updatedAt: now, createdAt: now, usage: { projects: 1, contracts: 2, tickets: 0 } };
  let document = { id: 'doc-one', originalName: 'Studio agreement.pdf', title: 'Studio agreement', category: 'Recording', kind: 'template', description: 'Studio terms', summary: '', archivedAt: null as string | null, needsReview: true, reviewedAt: null as string | null, reviewNote: '', extractionStatus: 'complete', extractionWarnings: [], textLength: 100, version: 0, draftCount: 2, text: 'The artist and producer agree to the following recording terms.' };
  let ticket: any = { id: 'request-one', userId: 'actor', kind: 'report', subject: 'Document problem', message: 'The recording document has a problem.', targetId: 'doc-one', targetTitle: 'Studio agreement', status: 'open', priority: 'normal', version: 0, createdAt: now, updatedAt: now, replies: [], user: { id: 'actor', name: 'Owner', email: actor.email } };
  const calls: { path: string; query: string; body?: any }[] = [];
  let failLibrary = false;
  let failUser = false;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url), 'https://music.example.com'); const path = parsed.pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, query: parsed.search, body });
    const page = (items: any[]) => Response.json({ items, total: items.length, page: 1, pageSize: 25 });
    if (path.endsWith('/auth/session')) return Response.json({ user: actor });
    if (path.endsWith('/billing/status')) return billingUnavailable ? Response.json({ error: 'Billing unavailable' }, { status: 503 }) : Response.json({ mode: 'preview', plan: role === 'admin' ? 'admin' : 'free', canExport: true });
    if (path.endsWith('/billing/catalog')) return Response.json({ mode: 'preview', price: null, checkoutAvailable: false });
    if (path === '/api/admin/summary') return Response.json({ totals: { users: 3, activeUsers: 2, suspendedUsers: 0, admins: 1, documents: 4, archivedDocuments: 0, needsReview: 2, projects: 5, contracts: 7, signedCopies: 1, openTickets: 1 }, daily: [{ day: '2026-11-13', users: 2, projects: 3, contracts: 1, tickets: 1 }] });
    if (path === '/api/admin/users') return page([account]);
    if (path === '/api/admin/users/member-one') return Response.json(account);
    if (path === '/api/admin/users/member-one/update') {
      if (failUser) return Response.json({ error: 'Account changed. Refresh before saving.' }, { status: 409 });
      account = { ...account, ...body, suspendedAt: body.suspended ? now : null, suspensionReason: body.suspended ? body.reason : null, updatedAt: new Date(Date.parse(account.updatedAt) + 1000).toISOString() }; return Response.json(account);
    }
    if (path === '/api/admin/library') return page([document]);
    if (path === '/api/admin/library/doc-one') return Response.json(document);
    if (path === '/api/admin/library/doc-one/update') {
      if (failLibrary) return Response.json({ error: 'Document changed. Refresh before saving.' }, { status: 409 });
      document = { ...document, ...body, needsReview: !body.reviewed, reviewedAt: body.reviewed ? now : null, version: document.version + 1 }; return Response.json(document);
    }
    if (path === '/api/admin/library/doc-one/archive') { document = { ...document, archivedAt: body.archived ? now : null, version: document.version + 1 }; return Response.json(document); }
    if (path === '/api/admin/tickets') return page([ticket]);
    if (path === '/api/admin/tickets/request-one') return Response.json(ticket);
    if (path === '/api/admin/tickets/request-one/update') {
      for (const [content, internal] of [[body.response, false], [body.note, true]]) if (content) ticket.replies.push({ id: `reply-${ticket.replies.length}`, body: content, authorName: 'Owner', isStaff: true, isInternal: internal, createdAt: now });
      ticket = { ...ticket, status: body.status, priority: body.priority, version: ticket.version + 1 }; return Response.json(ticket);
    }
    if (path === '/api/admin/activity') return page([]);
    if (path === '/api/support/tickets' && body) { ticket = { ...ticket, ...body, id: 'created-ticket', replies: [], version: 0 }; return Response.json(ticket, { status: 201 }); }
    if (path === '/api/support/tickets') return page([ticket]);
    if (path === `/api/support/tickets/${ticket.id}`) return Response.json(ticket);
    if (path === `/api/support/tickets/${ticket.id}/reply`) { ticket.replies.push({ id: 'member-reply', body: body.message, authorName: 'Owner', isStaff: false, isInternal: false, createdAt: now }); ticket = { ...ticket, version: ticket.version + 1 }; return Response.json(ticket); }
    throw new Error(`Unexpected request: ${path}`);
  };
  function Ready() { return useAuth().loading ? null : <UnsavedChangesProvider><BillingProvider><Outlet /></BillingProvider></UnsavedChangesProvider>; }
  const router = createMemoryRouter([{ element: <AuthProvider><Ready /></AuthProvider>, children: [
    { path: '/dashboard', element: <DashboardLayout />, children: [
      { index: true, element: <p>Workspace home</p> }, { path: 'admin', element: <AdminPage /> }, { path: 'support', element: <SupportPage /> },
    ] },
  ] }], { initialEntries: [path] });
  const container = window.document.createElement('div'); window.document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<RouterProvider router={router} />); await flush(); });
  const find = (label: string) => [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')].find(element => element.getAttribute('aria-label') === label || element.closest('label')?.textContent?.startsWith(label))!;
  return { container, router, calls, find,
    setFailLibrary: (value: boolean) => { failLibrary = value; },
    setFailUser: (value: boolean) => { failUser = value; },
    fill: async (label: string, value: string) => { await act(async () => {
      const element = find(label); assert.ok(element, `Missing ${label}`);
      const prototype = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : element instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await flush();
    }); },
    click: async (label: string) => { await act(async () => { const found = [...window.document.querySelectorAll<HTMLElement>('button, a')].find(element => element.textContent?.trim() === label); assert.ok(found, `Missing ${label}`); found.click(); await flush(); }); },
    submit: async (label: string) => { await act(async () => { container.querySelector(`form[aria-label="${label}"]`)!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await flush(); }); },
    navigate: async (path: string) => { await act(async () => { await router.navigate(path); await flush(); }); },
    cleanup: async () => { await act(async () => root.unmount()); router.dispose(); container.remove(); },
  };
}

test('admin overview and navigation are available only to administrator accounts', async () => {
  const admin = await setup();
  try {
    assert.ok(admin.container.querySelector('nav[aria-label="Workspace navigation"] a[href="/dashboard/admin"]'));
    assert.match(admin.container.textContent!, /Activity over 14 days/);
    assert.match(admin.container.textContent!, /Signed copies/);
    await admin.click('Users');
    assert.match(admin.container.textContent!, /member@example.test/);
  } finally { await admin.cleanup(); }
  const member = await setup('/dashboard/admin', 'member');
  try {
    assert.equal(member.router.state.location.pathname, '/dashboard');
    assert.equal(member.container.querySelector('a[href="/dashboard/admin"]'), null);
    assert.equal(member.calls.some(call => call.path.startsWith('/api/admin/')), false);
  } finally { await member.cleanup(); }
});

test('account privilege changes show a review step before submitting the selected role', async () => {
  const app = await setup('/dashboard/admin?tab=users&item=member-one');
  try {
    await app.fill('Role', 'admin');
    await app.click('Review account changes');
    assert.equal(app.calls.some(call => call.path.endsWith('/update')), false);
    assert.match(app.container.textContent!, /Administrator access includes every feature/);
    await app.click('Confirm account changes');
    assert.equal(app.calls.find(call => call.path.endsWith('/update'))?.body.role, 'admin');
  } finally { await app.cleanup(); }
});

test('library administrators retain website user management when billing is unavailable', async () => {
  const app = await setup('/dashboard/admin?tab=users', 'admin', true);
  try {
    assert.ok(app.container.querySelector('nav[aria-label="Workspace navigation"] a[href="/dashboard/admin"]'));
    assert.match(app.container.textContent!, /library administrator account manages the whole website/);
    assert.match(app.container.textContent!, /Manage users/);
    assert.equal(app.container.querySelector('a[href="/dashboard/billing"]'), null);
    await app.fill('Account role filter', 'admin');
    await app.fill('Account filter', 'unconfirmed');
    const query = new URLSearchParams(app.calls.filter(call => call.path === '/api/admin/users').at(-1)!.query);
    assert.equal(query.get('role'), 'admin');
    assert.equal(query.get('status'), 'unconfirmed');
  } finally { await app.cleanup(); }
});

test('user management saves display names, preserves failed edits, and suspends and reactivates accounts', async () => {
  const app = await setup('/dashboard/admin?tab=users&item=member-one');
  const suspend = () => app.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  try {
    await app.fill('Display name', 'Updated member');
    app.setFailUser(true);
    await app.click('Review account changes');
    await app.click('Confirm account changes');
    assert.match(app.container.textContent!, /Account changed/);
    assert.equal(app.find('Display name').value, 'Updated member');
    app.setFailUser(false);
    await act(async () => { suspend().click(); await flush(); });
    await app.fill('Suspension reason', 'Account review');
    await app.click('Review account changes');
    assert.match(app.container.textContent!, /Updated member/);
    await app.click('Confirm account changes');
    let change = app.calls.filter(call => call.path.endsWith('/update')).at(-1)!.body;
    assert.equal(change.name, 'Updated member');
    assert.equal(change.suspended, true);
    assert.equal(change.reason, 'Account review');
    assert.equal(suspend().checked, true);
    await act(async () => { suspend().click(); await flush(); });
    await app.click('Review account changes');
    await app.click('Confirm account changes');
    change = app.calls.filter(call => call.path.endsWith('/update')).at(-1)!.body;
    assert.equal(change.suspended, false);
    assert.equal(suspend().checked, false);
  } finally { await app.cleanup(); }
});

test('library errors preserve edits; saving and archiving update the document without deleting its drafts', async () => {
  const app = await setup('/dashboard/admin?tab=library&item=doc-one');
  try {
    await app.fill('Title', 'New studio agreement'); app.setFailLibrary(true);
    await app.click('Save library details');
    assert.match(app.container.textContent!, /Document changed. Refresh before saving/);
    assert.equal(app.find('Title').value, 'New studio agreement');
    await app.click('Reload latest details');
    assert.match(window.document.body.textContent!, /You have unsaved changes/);
    await app.click('Stay and edit');
    assert.equal(app.find('Title').value, 'New studio agreement');
    app.setFailLibrary(false); await app.click('Save library details');
    assert.equal(app.find('Title').value, 'New studio agreement');
    await app.click('Remove from library');
    assert.match(app.container.textContent!, /You can restore it later/);
    assert.equal(app.calls.some(call => call.path.endsWith('/archive')), false);
    await app.click('Confirm removal');
    assert.match(app.container.textContent!, /Existing saved drafts remain available/);
    assert.match(app.container.textContent!, /Restore to library/);
  } finally { await app.cleanup(); }
});

test('administrators can send a public reply and keep a separate internal note in a report', async () => {
  const app = await setup('/dashboard/admin?tab=tickets&item=request-one');
  try {
    await app.fill('Reply to member', 'We have reviewed the document.');
    await app.fill('Internal staff note', 'Staff follow-up details.');
    await app.fill('Request status', 'resolved');
    await app.click('Save request & replies');
    assert.match(app.container.textContent!, /We have reviewed the document/);
    assert.match(app.container.textContent!, /Internal note/);
    assert.match(app.container.textContent!, /Staff follow-up details/);
    assert.equal(app.find('Reply to member').value, '');
  } finally { await app.cleanup(); }
});

test('a member can create a linked content report and follow up in the support conversation', async () => {
  const app = await setup('/dashboard/support?kind=report&document=doc-one&title=Studio%20agreement', 'member');
  try {
    assert.equal(app.find('Subject').value, 'Issue with Studio agreement');
    await app.fill('Message', 'The recording document has a missing section.');
    await app.submit('New support request');
    assert.equal(app.router.state.location.search, '?ticket=created-ticket');
    assert.match(app.container.textContent!, /The recording document has a missing section/);
    assert.deepEqual(app.calls.find(call => call.path === '/api/support/tickets' && call.body)?.body, { kind: 'report', subject: 'Issue with Studio agreement', message: 'The recording document has a missing section.', targetId: 'doc-one' });
    await app.fill('Your reply', 'Here is additional context.');
    await app.submit('Reply to support');
    assert.match(app.container.textContent!, /Here is additional context/);
    assert.equal(app.find('Your reply').value, '');
  } finally { await app.cleanup(); }
});
