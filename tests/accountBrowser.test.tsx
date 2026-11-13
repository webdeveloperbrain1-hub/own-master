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
for (const name of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'])
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name as keyof typeof dom.window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, 'matchMedia', { configurable: true, value: (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }) });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider, Outlet } = await import('react-router');
await mkdir(resolve('.codex'), { recursive: true });
const bundlePath = resolve(`.codex/account-browser-tests-${process.pid}.mjs`);
const bundle = await build({ stdin: { contents: `
  export { AuthProvider } from './src/app/auth/AuthContext';
  export { UnsavedChangesProvider } from './src/app/components/UnsavedChanges';
  export { BillingProvider, ProExportNotice } from './src/app/billing/BillingContext';
  export { default as DashboardLayout } from './src/app/components/DashboardLayout';
  export { default as AccountPage } from './src/app/pages/Account';
  export { default as BillingPage } from './src/app/pages/Billing';
  export { default as PricingPage } from './src/app/pages/Pricing';
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_API_BASE_URL: '' }) } });
await writeFile(bundlePath, bundle.outputFiles[0].contents);
after(async () => { await unlink(bundlePath); dom.window.close(); });
const { AuthProvider, UnsavedChangesProvider, BillingProvider, ProExportNotice, DashboardLayout, AccountPage, BillingPage, PricingPage } = await import(pathToFileURL(bundlePath).href);
const flush = async () => { await setImmediate(); await setImmediate(); };

async function setup(role = 'member') {
  let user = { id: `account-${role}`, email: `${role}@example.test`, user_metadata: { name: 'Original Name' }, app_metadata: { role } };
  let failProfile = false;
  const calls: { path: string; body?: Record<string, string> }[] = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    if (path.endsWith('/session')) return Response.json({ user });
    if (path.endsWith('/profile')) {
      if (failProfile) return Response.json({ error: 'Profile service is unavailable.' }, { status: 503 });
      user = { ...user, user_metadata: { name: body.name } };
      return Response.json({ user });
    }
    if (path.endsWith('/change-password')) return body.currentPassword === 'wrong'
      ? Response.json({ error: 'Your current password is incorrect.', code: 'invalid_current_password' }, { status: 400 })
      : Response.json({ user });
    if (path.endsWith('/catalog')) return Response.json({ mode: 'stripe', checkoutAvailable: true, price: { amount: 1900, currency: 'usd', interval: 'month', intervalCount: 1 } });
    if (path.endsWith('/status')) return Response.json({ mode: 'stripe', plan: role === 'admin' ? 'admin' : 'free', canExport: role === 'admin', checkoutAvailable: role !== 'admin', portalAvailable: false, subscriptionStatus: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false });
    throw new Error(`Unexpected request: ${path}`);
  };
  const router = createMemoryRouter([{
    element: <AuthProvider><UnsavedChangesProvider><BillingProvider><Outlet /></BillingProvider></UnsavedChangesProvider></AuthProvider>,
    children: [
      { path: '/dashboard', element: <DashboardLayout />, children: [
        { index: true, element: <><ProExportNotice /><p>Workspace</p></> },
        { path: 'account', element: <AccountPage /> },
        { path: 'billing', element: <BillingPage /> },
      ] },
      { path: '/pricing', element: <PricingPage /> },
    ],
  }], { initialEntries: ['/dashboard/account'] });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<RouterProvider router={router} />); await flush(); });
  const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;
  const fill = async (id: string, value: string) => { await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(field(id), value);
    field(id).dispatchEvent(new window.Event('input', { bubbles: true }));
    await flush();
  }); };
  const submit = async (name: string) => { await act(async () => {
    container.querySelector(`form[aria-label="${name}"]`)!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  }); };
  return { container, router, calls, field, fill, submit,
    setFailProfile: (value: boolean) => { failProfile = value; },
    navigate: async (path: string) => { await act(async () => { await router.navigate(path); await flush(); }); },
    cleanup: async () => { await act(async () => root.unmount()); router.dispose(); container.remove(); },
  };
}

test('Account edits refresh the sidebar, preserve failed edits, and keep sign-in identity read-only', async () => {
  const app = await setup();
  try {
    assert.ok(app.container.querySelector('nav[aria-label="Workspace navigation"] a[href="/dashboard/account"]'));
    assert.equal(app.field('account-email').readOnly, true);
    assert.equal(app.field('account-email').value, 'member@example.test');
    await app.fill('account-name', '  New Name  ');
    app.setFailProfile(true);
    await app.submit('Edit profile');
    assert.match(app.container.textContent!, /Profile service is unavailable/);
    assert.equal(app.field('account-name').value, '  New Name  ');
    app.setFailProfile(false);
    await app.submit('Edit profile');
    assert.equal(app.field('account-name').value, 'New Name');
    assert.match(app.container.textContent!, /Your profile has been updated/);
    assert.equal(app.container.querySelector('aside[aria-label="Workspace sidebar"] [title="New Name"]')?.textContent, 'New Name');
    assert.deepEqual(app.calls.filter(call => call.path.endsWith('/profile')).at(-1)?.body, { name: 'New Name' });
    await app.navigate('/dashboard');
    assert.equal(app.router.state.location.pathname, '/dashboard');
  } finally { await app.cleanup(); }
});

test('password form validates confirmation, preserves a failed attempt, and clears passwords after success', async () => {
  const app = await setup();
  try {
    await app.fill('account-current-password', 'trial123');
    await app.fill('account-new-password', 'New-trial123!');
    await app.fill('account-confirm-password', 'Mismatch1!');
    await app.submit('Change password');
    assert.match(app.container.textContent!, /Your passwords do not match/);
    assert.equal(app.calls.filter(call => call.path.endsWith('/change-password')).length, 0);
    await app.fill('account-current-password', 'wrong');
    await app.fill('account-confirm-password', 'New-trial123!');
    await app.submit('Change password');
    assert.match(app.container.textContent!, /Your current password is incorrect/);
    assert.equal(app.field('account-new-password').value, 'New-trial123!');
    await app.fill('account-current-password', 'trial123');
    await app.submit('Change password');
    assert.match(app.container.textContent!, /Your password has been changed. Other sessions have been signed out/);
    for (const id of ['account-current-password', 'account-new-password', 'account-confirm-password']) assert.equal(app.field(id).value, '');
    assert.ok(!JSON.stringify(window.localStorage).includes('New-trial123!'));
    await app.navigate('/dashboard');
    assert.equal(app.router.state.location.pathname, '/dashboard');
  } finally { await app.cleanup(); }
});

test('administrators see full access without pricing requests, billing navigation, or upgrade prompts', async () => {
  const app = await setup('admin');
  try {
    assert.match(app.container.textContent!, /Full administrator access/);
    assert.equal(app.container.querySelector('nav[aria-label="Workspace navigation"] a[href="/dashboard/billing"]'), null);
    await app.navigate('/dashboard/billing?plan=pro');
    assert.match(app.container.textContent!, /No plan or subscription is required/);
    assert.doesNotMatch(app.container.textContent!, /Continue to secure checkout|Review Pro|View Pro/);
    await app.navigate('/pricing');
    assert.match(app.container.textContent!, /Full administrator access/);
    assert.equal(app.calls.some(call => call.path.endsWith('/catalog')), false);
    await app.navigate('/dashboard');
    await act(async () => { window.dispatchEvent(new window.Event('own-masters-upgrade-required')); await flush(); });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.doesNotMatch(app.container.textContent!, /Take your contracts further with Pro|View Pro/);
  } finally { await app.cleanup(); }
});

test('member accounts keep their existing plans and billing links', async () => {
  const app = await setup();
  try {
    assert.equal(app.container.querySelector('[aria-label="Administrator access"]'), null);
    assert.ok(app.container.querySelector('nav[aria-label="Workspace navigation"] a[href="/dashboard/billing"]'));
    assert.equal(app.calls.some(call => call.path.endsWith('/catalog')), true);
    await app.navigate('/dashboard');
    assert.match(app.container.textContent!, /Take your contracts further with Pro/);
  } finally { await app.cleanup(); }
});
