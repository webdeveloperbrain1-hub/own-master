import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/edit', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name as keyof typeof dom.window] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider, Outlet, useNavigate } = await import('react-router');
const { UnsavedChangesProvider, useLeaveConfirmation, useUnsavedChanges } = await import('../src/app/components/UnsavedChanges.tsx');
const { useDraftRecovery } = await import('../src/app/components/DraftRecovery.tsx');

async function setup() {
  let discarded = 0;
  let logouts = 0;
  let finishSave = (success: boolean) => {};
  function Editor() {
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const markClean = useUnsavedChanges(dirty, busy, () => { discarded++; });
    finishSave = (success) => {
      setBusy(false);
      if (success) { setDirty(false); markClean(); }
    };
    return <>
      <p>{dirty ? 'Edited contract' : 'Saved contract'}</p>
      <button onClick={() => setDirty(true)}>Edit</button>
      <button onClick={() => setBusy(true)}>Save</button>
    </>;
  }
  function Layout() {
    const requestLeave = useLeaveConfirmation();
    const navigate = useNavigate();
    return <><button onClick={() => requestLeave(() => { logouts++; navigate('/other'); })}>Logout</button><Outlet /></>;
  }
  const router = createMemoryRouter([{
    path: '/', element: <UnsavedChangesProvider><Layout /></UnsavedChangesProvider>,
    children: [{ path: 'edit', element: <Editor /> }, { path: 'other', element: <p>Other page</p> }],
  }], { initialEntries: ['/other', '/edit'], initialIndex: 1 });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<RouterProvider router={router} />));
  const button = (text: string) => {
    const found = [...document.querySelectorAll('button')].find((element) => element.textContent === text);
    assert.ok(found, `Expected button: ${text}`);
    return found;
  };
  return {
    router, button,
    click: async (text: string) => { await act(async () => button(text).click()); },
    navigate: async (to: string | number) => { await act(async () => { await router.navigate(to as string); }); },
    finish: async (success: boolean) => { await act(async () => finishSave(success)); },
    discarded: () => discarded, logouts: () => logouts,
    cleanup: async () => { await act(async () => root.unmount()); router.dispose(); container.remove(); },
  };
}

test('clean editors navigate freely; staying preserves edits; discarding proceeds once', async () => {
  const app = await setup();
  try {
    await app.navigate('/other');
    assert.equal(app.router.state.location.pathname, '/other');
    await app.navigate('/edit');
    await app.click('Edit');
    await app.navigate('/other');
    assert.equal(app.router.state.location.pathname, '/edit');
    assert.match(document.body.textContent!, /You have unsaved changes/);
    await app.click('Stay and edit');
    assert.match(document.body.textContent!, /Edited contract/);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await app.navigate('/other');
    await app.click('Discard and leave');
    assert.equal(app.router.state.location.pathname, '/other');
    assert.equal(app.discarded(), 1);
  } finally { await app.cleanup(); }
});

test('Back and Forward retain the correct history after cancelled and accepted navigation', async () => {
  const app = await setup();
  try {
    await app.click('Edit');
    await app.navigate(-1);
    assert.equal(app.router.state.location.pathname, '/edit');
    await app.click('Stay and edit');
    await app.navigate(-1);
    await app.click('Discard and leave');
    assert.equal(app.router.state.location.pathname, '/other');
    await app.navigate(1);
    assert.equal(app.router.state.location.pathname, '/edit');
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
  } finally { await app.cleanup(); }
});

test('logout waits for consent and does not invalidate the session when cancelled', async () => {
  const app = await setup();
  try {
    await app.click('Edit');
    await app.click('Logout');
    assert.equal(app.logouts(), 0);
    await app.click('Stay and edit');
    assert.equal(app.logouts(), 0);
    await app.click('Logout');
    await app.click('Discard and leave');
    assert.equal(app.logouts(), 1);
    assert.equal(app.router.state.location.pathname, '/other');
    assert.equal(app.discarded(), 1);
  } finally { await app.cleanup(); }
});

test('navigation waits during saving, proceeds on success, and remains blocked on failure', async () => {
  for (const success of [true, false]) {
    const app = await setup();
    try {
      await app.click('Edit');
      await app.click('Save');
      await app.navigate('/other');
      assert.match(document.body.textContent!, /Your changes are being saved/);
      assert.equal(app.button('Discard and leave').disabled, true);
      await app.finish(success);
      assert.equal(app.router.state.location.pathname, success ? '/other' : '/edit');
      if (!success) {
        assert.match(document.body.textContent!, /You have unsaved changes/);
        await app.click('Stay and edit');
        assert.match(document.body.textContent!, /Edited contract/);
      }
      assert.equal(app.discarded(), 0);
    } finally { await app.cleanup(); }
  }
});

test('refresh and tab-close warnings apply only while dirty or saving', async () => {
  const app = await setup();
  const warns = () => {
    const event = new window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    assert.equal(warns(), false);
    await app.click('Edit');
    assert.equal(warns(), true);
    await app.click('Save');
    assert.equal(warns(), true);
    await app.finish(true);
    assert.equal(warns(), false);
    await app.navigate('/other');
    assert.equal(warns(), false);
  } finally { await app.cleanup(); }
});

test('a pending logout proceeds after a successful save and stays pending after failure', async () => {
  for (const success of [true, false]) {
    const app = await setup();
    try {
      await app.click('Edit');
      await app.click('Save');
      await app.click('Logout');
      assert.equal(app.logouts(), 0);
      assert.equal(app.button('Discard and leave').disabled, true);
      await app.finish(success);
      assert.equal(app.logouts(), success ? 1 : 0);
      assert.equal(app.router.state.location.pathname, success ? '/other' : '/edit');
    } finally { await app.cleanup(); }
  }
});

test('reopening the editor offers recovery without replacing the account version; restore, save, and revert clean up correctly', async () => {
  window.sessionStorage.clear();
  const saved = { templateId: 'one', name: 'Saved title', text: 'Saved text', html: '<p>Saved text</p>', baseUpdatedAt: '2026-11-03T00:00:00.000Z' };
  const edited = { ...saved, name: 'Unsaved title', text: 'Unsaved wording', html: '<p><strong>Unsaved wording</strong></p>' };
  let dirty = false;
  let recovered: ReturnType<typeof useDraftRecovery>['copy'] = null;
  let current = saved;
  function Editor() {
    const [document, setDocument] = useState(saved);
    const [changed, setChanged] = useState(false);
    const recovery = useDraftRecovery('owner', 'saved-contract:one', changed, document);
    dirty = changed;
    recovered = recovery.copy;
    current = document;
    return <>
      <button onClick={() => { setDocument(edited); setChanged(true); }}>Edit</button>
      <button onClick={() => { setDocument(recovery.copy!); setChanged(true); recovery.clear(); }}>Restore</button>
      <button onClick={() => { setDocument(saved); setChanged(false); }}>Revert</button>
      <button onClick={() => { setChanged(false); recovery.clear(); }}>Save</button>
    </>;
  }
  const container = document.createElement('div');
  document.body.append(container);
  let root = createRoot(container);
  const click = async (text: string) => { await act(async () => [...container.querySelectorAll('button')].find((element) => element.textContent === text)!.click()); };
  try {
    await act(async () => root.render(<Editor />));
    await click('Edit');
    assert.equal(window.sessionStorage.length, 1);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<Editor />));
    assert.equal(dirty, false);
    assert.equal(current.name, saved.name);
    assert.equal(recovered!.name, edited.name);
    assert.equal(recovered!.html, edited.html);
    assert.equal(window.sessionStorage.length, 1);
    await click('Restore');
    assert.equal(dirty, true);
    assert.equal(current.text, edited.text);
    assert.equal(current.html, edited.html);
    assert.equal(recovered, null);
    assert.equal(window.sessionStorage.length, 1);
    await click('Revert');
    assert.equal(dirty, false);
    assert.equal(window.sessionStorage.length, 0);
    await click('Edit');
    await click('Save');
    assert.equal(window.sessionStorage.length, 0);
  } finally { await act(async () => root.unmount()); container.remove(); window.sessionStorage.clear(); }
});
