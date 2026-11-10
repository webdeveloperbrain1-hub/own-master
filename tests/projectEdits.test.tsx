import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import * as React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name as keyof typeof dom.window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider, Outlet, Link, useNavigate } = await import('react-router');
// Compile the actual UI with Vite's environment constants, keeping one React instance.
await mkdir(resolve('.codex'), { recursive: true });
const bundlePath = resolve(`.codex/project-edits-tests-${process.pid}.mjs`);
const bundle = await build({ stdin: { contents: `
  export { ProjectDetailPage, TrackReviewWorkspace } from './src/app/components/ProjectWorkspace';
  export { AuthProvider } from './src/app/auth/AuthContext';
  export { UnsavedChangesProvider, useLeaveConfirmation } from './src/app/components/UnsavedChanges';
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_API_BASE_URL: '' }) } });
await writeFile(bundlePath, bundle.outputFiles[0].contents);
after(async () => { await unlink(bundlePath); dom.window.close(); });
const { ProjectDetailPage, TrackReviewWorkspace, AuthProvider, UnsavedChangesProvider, useLeaveConfirmation } = await import(pathToFileURL(bundlePath).href);

const initial = { id: 'one', title: 'Saved song', lyrics: 'Saved lyrics', hasAudio: false, comments: [], contracts: [], updatedAt: '2026-11-03T00:00:00Z' };
let saved = structuredClone(initial);
let owner = 'owner-a';
let saveResult: (() => Promise<boolean>) | null = null;
let posts = 0;
globalThis.fetch = async (url, init) => {
  const path = String(url);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (path === '/api/auth/session') return json({ user: { id: owner, email: 'test@example.com', user_metadata: {} } });
  if (init?.method === 'POST') {
    posts++;
    if (saveResult && !await saveResult()) return json({ error: 'Test save failed' }, 500);
    const body = JSON.parse(String(init.body));
    if (path.endsWith('/update')) saved = { ...saved, title: body.title.trim(), lyrics: body.lyrics };
    if (path.endsWith('/comments')) saved = { ...saved, comments: [...saved.comments, { id: 'note', body: body.body, createdAt: initial.updatedAt }] } as typeof saved;
    return json(saved);
  }
  if (path === '/api/projects') return json([]);
  if (path === '/api/projects/one') return json(saved);
  if (path === '/api/projects/two') return json({ ...saved, id: 'two', title: 'Other song' });
  return json([]);
};
async function flush() { await setImmediate(); await setImmediate(); }
async function setup(kind = 'detail', reset = true) {
  if (reset) { saved = structuredClone(initial); window.sessionStorage.clear(); owner = 'owner-a'; posts = 0; saveResult = null; }
  function Layout() {
    const leave = useLeaveConfirmation();
    const navigate = useNavigate();
    return <><Link to="/other">Leave page</Link><button onClick={() => leave(() => navigate('/other'))}>Logout</button><Outlet /></>;
  }
  const router = createMemoryRouter([{ path: '/', element: <UnsavedChangesProvider><Layout /></UnsavedChangesProvider>, children: [
    { path: 'projects/:id', element: <ProjectDetailPage /> }, { path: 'dashboard/projects/:id', element: <ProjectDetailPage /> }, { path: 'new', element: <TrackReviewWorkspace /> }, { path: 'other', element: <p>Other page</p> },
  ] }], { initialEntries: ['/other', kind === 'detail' ? '/projects/one' : '/new'], initialIndex: 1 });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AuthProvider><RouterProvider router={router} /></AuthProvider>); await flush(); });
  const button = (name: string) => {
    const found = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === name);
    assert.ok(found, `Expected button ${name}`); return found;
  };
  const click = async (name: string) => { await act(async () => { button(name).click(); await flush(); }); };
  const field = (label: string) => {
    const el = [...container.querySelectorAll('label')].find((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('input,textarea').forEach((field) => field.remove());
      return copy.textContent?.trim() === label;
    })?.querySelector('input,textarea');
    assert.ok(el, `Expected field ${label}`); return el as HTMLInputElement | HTMLTextAreaElement;
  };
  const fill = async (label: string, value: string) => { await act(async () => {
    const el = field(label);
    const prototype = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  }); };
  const navigate = async (to: string | number) => { await act(async () => { await router.navigate(to as string); await flush(); }); };
  const warns = () => { const event = new window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
  return { router, container, button, click, field, fill, navigate, warns,
    cleanup: async () => { await act(async () => root.unmount()); router.dispose(); container.remove(); },
  };
}

test('song details and notes survive section switches, cancelled navigation and logout; explicit leave clears recovery', async () => {
  const app = await setup();
  try {
    assert.equal(app.warns(), false);
    await app.click('Edit details'); await app.fill('Song title', 'Unsaved song'); await app.fill('Lyrics and reference notes', 'Unsaved lyrics');
    await app.click('Notes (0)'); await app.fill('New project note', 'Unfinished note');
    await app.click('Overview'); assert.equal(app.field('Song title').value, 'Unsaved song');
    await app.navigate(-1); assert.equal(app.router.state.location.pathname, '/projects/one');
    await app.click('Stay and edit');
    await app.click('Logout'); await app.click('Stay and edit');
    assert.equal(app.field('Lyrics and reference notes').value, 'Unsaved lyrics');
    assert.equal(app.warns(), true);
    await app.navigate('/other'); await app.click('Discard and leave');
    assert.equal(app.router.state.location.pathname, '/other');
    assert.equal(window.sessionStorage.length, 0);
    assert.equal(posts, 0); assert.equal(saved.title, initial.title);
  } finally { await app.cleanup(); }
});

test('Cancel confirms detail discard and preserves an unfinished note; saving that note clears protection', async () => {
  const app = await setup();
  try {
    await app.click('Edit details'); await app.fill('Song title', 'Unsaved title');
    await app.click('Notes (0)'); await app.fill('New project note', 'Keep this note'); await app.click('Overview');
    await app.click('Cancel'); await app.click('Keep editing'); assert.equal(app.field('Song title').value, 'Unsaved title');
    await app.click('Cancel'); await app.click('Discard detail edits');
    assert.equal(saved.title, initial.title); assert.equal(app.warns(), true);
    await app.click('Notes (0)'); assert.equal(app.field('New project note').value, 'Keep this note');
    await app.click('Add note'); assert.equal(app.field('New project note').value, '');
    assert.equal(window.sessionStorage.length, 0); assert.equal(app.warns(), false);
    await app.navigate('/other'); assert.equal(app.router.state.location.pathname, '/other');
  } finally { await app.cleanup(); }
});

test('failed and pending saves retain work; saving details does not discard a note', async () => {
  const app = await setup();
  try {
    await app.click('Edit details'); await app.fill('Song title', 'Saved new title');
    await app.click('Notes (0)'); await app.fill('New project note', 'Still unfinished'); await app.click('Overview');
    let finish!: (ok: boolean) => void;
    saveResult = () => new Promise((resolve) => { finish = resolve; });
    await app.click('Save details'); await app.navigate('/other');
    assert.equal(app.button('Discard and leave').disabled, true);
    await act(async () => { finish(false); await flush(); });
    assert.equal(app.router.state.location.pathname, '/projects/one');
    await app.click('Stay and edit'); assert.equal(app.field('Song title').value, 'Saved new title');
    saveResult = null; await app.click('Save details');
    assert.equal(saved.title, 'Saved new title'); assert.equal(app.warns(), true);
    await app.click('Notes (0)'); assert.equal(app.field('New project note').value, 'Still unfinished');
    await app.click('Add note'); assert.equal(app.warns(), false); assert.equal(window.sessionStorage.length, 0);
  } finally { await app.cleanup(); }
});

test('refresh recovery restores title, lyrics and note only on request, scoped to the account and project', async () => {
  let app = await setup();
  await app.click('Edit details'); await app.fill('Song title', 'Recovered title'); await app.fill('Lyrics and reference notes', 'Recovered lyrics');
  await app.click('Notes (0)'); await app.fill('New project note', 'Recovered note'); await app.cleanup();
  owner = 'owner-b'; app = await setup('detail', false);
  assert.doesNotMatch(app.container.textContent!, /Unsaved edits found/); await app.cleanup();
  owner = 'owner-a'; app = await setup('detail', false);
  try {
    assert.match(app.container.textContent!, /Unsaved edits found/); assert.equal(saved.title, initial.title);
    assert.equal(app.button('Edit details').disabled, true);
    await app.click('Restore unsaved edits'); assert.equal(app.field('Song title').value, 'Recovered title');
    assert.equal(app.field('Lyrics and reference notes').value, 'Recovered lyrics');
    await app.click('Notes (0)'); assert.equal(app.field('New project note').value, 'Recovered note');
    await app.navigate('/projects/two'); await app.click('Discard and leave');
    assert.doesNotMatch(app.container.textContent!, /Unsaved edits found/);
    assert.match(app.container.textContent!, /Other song/);
  } finally { await app.cleanup(); }
});

test('new-song recovery keeps text and explains that selected audio must be chosen again', async () => {
  let app = await setup('new');
  await app.fill('Track title', 'New song'); await app.fill('Lyrics (optional if you add music)', 'New lyrics');
  await act(async () => {
    const input = app.container.querySelector('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['audio'], 'demo.wav', { type: 'audio/wav' })] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await app.cleanup(); app = await setup('new', false);
  try {
    await app.click('Restore unsaved edits'); assert.equal(app.field('Track title').value, 'New song');
    assert.equal(app.field('Lyrics (optional if you add music)').value, 'New lyrics');
    assert.match(app.container.textContent!, /Choose “demo.wav” again/);
    await app.click('Save project'); assert.equal(posts, 0);
    await app.click('Remove audio selection');
    saveResult = async () => false; await app.click('Save project'); assert.equal(app.field('Track title').value, 'New song');
    saveResult = null; await app.click('Save project');
    assert.equal(app.router.state.location.pathname, '/dashboard/projects/one');
    assert.match(app.container.textContent!, /Saved song/);
    assert.equal(window.sessionStorage.length, 0); assert.equal(app.warns(), false);
  } finally { await app.cleanup(); }
});

test('saving a note keeps detail edits; a pending navigation proceeds only after the final save succeeds', async () => {
  const app = await setup();
  try {
    await app.click('Edit details'); await app.fill('Song title', 'Keep these details');
    await app.click('Notes (0)'); await app.fill('New project note', 'Save just this note');
    saveResult = async () => false; await app.click('Add note');
    assert.equal(app.field('New project note').value, 'Save just this note');
    saveResult = null; await app.click('Add note');
    assert.equal(app.warns(), true); assert.equal(saved.title, initial.title);
    await app.click('Overview'); assert.equal(app.field('Song title').value, 'Keep these details');
    let finish!: (ok: boolean) => void;
    saveResult = () => new Promise((resolve) => { finish = resolve; });
    await app.click('Save details'); await app.navigate('/other');
    assert.equal(app.router.state.location.pathname, '/projects/one');
    await act(async () => { finish(true); await flush(); });
    assert.equal(app.router.state.location.pathname, '/other');
    assert.equal(saved.title, 'Keep these details'); assert.equal(window.sessionStorage.length, 0);
  } finally { await app.cleanup(); }
});

test('unavailable recovery storage explains the limitation while navigation protection still works', async () => {
  const app = await setup();
  const prototype = Object.getPrototypeOf(window.sessionStorage);
  const original = prototype.setItem;
  prototype.setItem = () => { throw new Error('Storage full'); };
  try {
    await app.click('Notes (0)'); await app.fill('New project note', 'Keep this despite storage failure');
    assert.match(app.container.textContent!, /Recovery is unavailable in this browser/);
    await app.navigate('/other'); await app.click('Stay and edit');
    assert.equal(app.field('New project note').value, 'Keep this despite storage failure');
    assert.equal(app.warns(), true);
  } finally { prototype.setItem = original; await app.cleanup(); }
});
