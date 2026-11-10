import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import * as React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'DocumentFragment', 'MutationObserver', 'getComputedStyle'])
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name as keyof typeof dom.window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, Outlet, RouterProvider } = await import('react-router');
await mkdir(resolve('.codex'), { recursive: true });
const bundlePath = resolve(`.codex/billing-browser-tests-${process.pid}.mjs`);
const bundle = await build({ stdin: { contents: `
  export { AuthProvider } from './src/app/auth/AuthContext';
  export { UnsavedChangesProvider } from './src/app/components/UnsavedChanges';
  export { BillingProvider } from './src/app/billing/BillingContext';
  export { default as PricingPage } from './src/app/pages/Pricing';
  export { default as BillingPage } from './src/app/pages/Billing';
  export { ContractDraftDownloadButton } from './src/app/components/ContractDocumentEditor';
  export { proPriceLabel } from './src/app/data/billingClient';
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_API_BASE_URL: '' }) } });
await writeFile(bundlePath, bundle.outputFiles[0].contents);
after(async () => { await unlink(bundlePath); dom.window.close(); });
const { AuthProvider, UnsavedChangesProvider, BillingProvider, PricingPage, BillingPage, ContractDraftDownloadButton, proPriceLabel } = await import(pathToFileURL(bundlePath).href);
const previewStatus = { mode: 'preview', plan: 'free', canExport: true, checkoutAvailable: false, portalAvailable: false, subscriptionStatus: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false };
let posts: string[] = [];
async function setup(path: string, status = previewStatus, offline = false) {
  posts = [];
  globalThis.fetch = async (url, init) => {
    const route = String(url);
    if (init?.method === 'POST') posts.push(route);
    if (offline && route.includes('/billing/')) throw new TypeError('Offline');
    let data: unknown;
    if (route.endsWith('/session')) data = { user: { id: 'owner', email: 'owner@example.test', user_metadata: { name: 'Owner' } } };
    else if (route.endsWith('/billing/catalog')) data = { mode: status.mode, checkoutAvailable: status.mode === 'stripe', price: status.mode === 'stripe' ? { amount: 1900, currency: 'usd', interval: 'month', intervalCount: 1 } : null };
    else if (route.endsWith('/billing/status')) data = status;
    else throw new Error(`Unexpected request: ${route}`);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const router = createMemoryRouter([{ element: <UnsavedChangesProvider><BillingProvider><Outlet /></BillingProvider></UnsavedChangesProvider>, children: [
    { path: '/pricing', element: <PricingPage /> }, { path: '/dashboard/billing', element: <BillingPage /> },
    { path: '/editor', element: <ContractDraftDownloadButton draftId="saved-draft" /> },
  ] }], { initialEntries: [path] });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AuthProvider><RouterProvider router={router} /></AuthProvider>); await setImmediate(); await setImmediate(); });
  const button = (text: string) => {
    const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === text.trim());
    assert.ok(found, `Missing button ${text}`); return found;
  };
  const close = async () => { await act(async () => root.unmount()); container.remove(); };
  return { container, button, close };
}

test('initial pricing offers real free access without a simulated Pro plan or payment controls', async () => {
  const ui = await setup('/pricing');
  try {
    assert.match(ui.container.textContent!, /Free early access/);
    assert.match(ui.container.textContent!, /No payment or card details are required/);
    assert.ok(ui.container.querySelector('a[href="/dashboard"]'));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.doesNotMatch(ui.container.textContent!, /Preview Pro|Announced at launch|Payments coming soon/);
    assert.equal(ui.container.querySelectorAll('input').length, 0);
    assert.deepEqual(posts, []);
  } finally { await ui.close(); }
});

test('initial account plan has no checkout or portal controls and never requests payment', async () => {
  const ui = await setup('/dashboard/billing');
  try {
    assert.doesNotMatch(ui.container.textContent!, /Payments coming soon|Manage billing|Continue to secure checkout|Preview Pro/);
    assert.match(ui.container.textContent!, /Your early-access plan/);
    assert.equal(ui.container.querySelectorAll('input').length, 0);
    assert.deepEqual(posts, []);
  } finally { await ui.close(); }
});

test('a forged checkout return never displays a paid plan or grants export access', async () => {
  const ui = await setup('/dashboard/billing?checkout=returned', { ...previewStatus, mode: 'stripe', canExport: false, checkoutAvailable: true });
  try {
    assert.match(ui.container.textContent!, /Waiting for payment confirmation/);
    assert.doesNotMatch(ui.container.textContent!, /Your Pro subscription is active/);
    assert.match(ui.container.textContent!, /\$19\.00 \/ month/);
    assert.deepEqual(posts, []);
  } finally { await ui.close(); }
});

test('Free users see an upgrade before attempting an export, while both formats are present', async () => {
  const ui = await setup('/editor', { ...previewStatus, mode: 'stripe', canExport: false, checkoutAvailable: true });
  try {
    assert.ok(ui.button('Download Word'));
    await act(async () => ui.button('Download draft PDF').click());
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.deepEqual(posts, []);
  } finally { await ui.close(); }
});

test('billing outages are shown as unavailable rather than a fake preview or paid plan', async () => {
  const ui = await setup('/dashboard/billing', previewStatus, true);
  try {
    assert.match(ui.container.textContent!, /Billing is temporarily unavailable/);
    assert.doesNotMatch(ui.container.textContent!, /Continue to secure checkout|Own Masters Pro/);
    assert.match(ui.container.textContent!, /Your plan is temporarily unavailable/);
    assert.doesNotMatch(ui.container.textContent!, /Paid plans are coming soon/);
    assert.deepEqual(posts, []);
  } finally { await ui.close(); }
});

test('configured prices handle monthly, annual, zero-decimal and Stripe compatibility currencies', () => {
  const label = (currency: string, amount: number, interval = 'month') => proPriceLabel({ mode: 'stripe', checkoutAvailable: true, price: { amount, currency, interval, intervalCount: 1 } });
  assert.equal(label('usd', 1900), '$19.00 / month');
  assert.equal(label('usd', 19000, 'year'), '$190.00 / year');
  assert.match(label('jpy', 1900), /1,900/);
  assert.match(label('isk', 190000), /1,900/);
});
