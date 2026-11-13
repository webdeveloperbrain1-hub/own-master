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
for (const name of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent'])
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name as keyof typeof dom.window] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, 'matchMedia', { configurable: true, value: (media: string) => ({
  matches: false, media, addEventListener() {}, removeEventListener() {},
}) });
const { act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router');
await mkdir(resolve('.codex'), { recursive: true });
const bundlePath = resolve(`.codex/auth-browser-tests-${process.pid}.mjs`);
const bundle = await build({ stdin: { contents: `
  export { AuthProvider, useAuth } from './src/app/auth/AuthContext';
  export { LoginPage, SignupPage, ConfirmEmailPage, ResetPasswordPage, ResendConfirmationPage } from './src/app/pages/AuthPages';
  export { default as LandingNavigation } from './src/app/components/LandingNavigation';
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_API_BASE_URL: '' }) } });
await writeFile(bundlePath, bundle.outputFiles[0].contents);
after(async () => { await unlink(bundlePath); dom.window.close(); });
const { AuthProvider, useAuth, LoginPage, SignupPage, ConfirmEmailPage, ResetPasswordPage, ResendConfirmationPage, LandingNavigation } = await import(pathToFileURL(bundlePath).href);
const person = { id: 'owner-one', email: 'owner@example.test', user_metadata: { name: 'Owner' } };
let session: () => Promise<unknown>;
let posts: string[];
let confirmation = false;
let configurationFails = false;
let unconfirmedLogin = false;
globalThis.fetch = async (url, init) => {
  const path = String(url);
  let data: unknown;
  if (path.endsWith('/session')) data = await session();
  else if (path.endsWith('/config')) {
    if (configurationFails) throw new TypeError('Failed to fetch');
    data = { emailDeliveryAvailable: true, passwordResetAvailable: true, emailPreviewUrl: null };
  } else {
    posts.push(path);
    if (path.endsWith('/login') && unconfirmedLogin)
      return new Response(JSON.stringify({ error: 'Confirm your email before logging in.', code: 'email_not_confirmed' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    if (path.endsWith('/signup')) data = { needsEmailConfirmation: true, emailSent: true };
    if (path.endsWith('/login')) data = { user: person };
    if (path.endsWith('/logout')) data = { ok: true };
    if (path.endsWith('/reset-password')) data = { ok: true };
    if (path.endsWith('/resend-confirmation')) data = { ok: true };
    if (path.endsWith('/confirm-email')) { confirmation = true; data = { returnTo: '/dashboard/contracts' }; }
  }
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
function Probe() {
  const auth = useAuth();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return <>
    <p>{auth.loading ? 'Checking' : auth.user ? 'Signed in' : 'Signed out'}</p>
    <p role="status">{auth.sessionError || error}</p>
    {auth.user && <input aria-label="Working text" value={text} onChange={(event) => setText(event.target.value)} />}
    <button onClick={() => void auth.signIn({ email: person.email, password: 'Abcdef1!' }).catch((error) => setError(error.message))}>Login</button>
    <button onClick={() => void auth.signOut().catch((error) => setError(error.message))}>Logout</button>
    <button onClick={auth.retrySession}>Retry</button>
  </>;
}
async function flush() { await setImmediate(); await setImmediate(); }
async function setup(path = '/probe', signedIn = false, offline = false, initialSession?: () => Promise<unknown>) {
  posts = []; confirmation = false; configurationFails = offline; unconfirmedLogin = false;
  session = initialSession ?? (async () => { if (offline) throw new TypeError('Failed to fetch'); return { user: signedIn ? person : null }; });
  const router = createMemoryRouter([
    { path: '/', element: <LandingNavigation onSection={() => {}} /> },
    { path: '/probe', element: <Probe /> }, { path: '/login', element: <LoginPage /> }, { path: '/signup', element: <SignupPage /> },
    { path: '/auth/confirm', element: <ConfirmEmailPage /> }, { path: '/reset-password', element: <ResetPasswordPage /> },
    { path: '/resend-confirmation', element: <ResendConfirmationPage /> },
    { path: '/dashboard', element: <p>Workspace</p> }, { path: '/dashboard/contracts', element: <p>Contracts</p> },
  ], { initialEntries: [path] });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<AuthProvider><RouterProvider router={router} /></AuthProvider>); await flush(); });
  const button = (name: string) => {
    const element = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === name || button.getAttribute('aria-label') === name);
    assert.ok(element, `Expected ${name}`); return element;
  };
  const click = async (name: string) => { await act(async () => { button(name).click(); await flush(); }); };
  const fill = async (selector: string, value: string) => { await act(async () => {
    const element = container.querySelector(selector)!;
    assert.ok(element, `Expected ${selector}`);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  }); };
  const submit = async () => { await act(async () => { container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await flush(); }); };
  return { container, router, button, click, fill, submit,
    focus: async () => { await act(async () => { window.dispatchEvent(new window.Event('focus')); await flush(); }); },
    cleanup: async () => { await act(async () => root.unmount()); router.dispose(); container.remove(); },
  };
}

test('landing navigation waits for the session and shows Dashboard for the signed-in account on desktop and mobile', async () => {
  let finish!: (result: unknown) => void;
  const app = await setup('/', false, false, () => new Promise(resolve => { finish = resolve; }));
  try {
    assert.equal(app.container.querySelector('a[href="/login"], a[href="/signup"]'), null);
    await app.click('Open navigation menu');
    assert.equal(app.container.querySelector('#mobile-site-menu a[href="/login"], #mobile-site-menu a[href="/signup"]'), null);
    await act(async () => { finish({ user: person }); await flush(); });
    assert.equal(app.container.querySelector('a[href="/login"], a[href="/signup"]'), null);
    assert.ok(app.container.querySelector('nav[aria-label="Main navigation"] a[href="/dashboard"]'));
    for (const link of app.container.querySelectorAll('a[href="/dashboard"]')) assert.equal(link.textContent?.trim(), 'Dashboard');
    await app.click('Open navigation menu');
    const dashboard = app.container.querySelector('#mobile-site-menu a[href="/dashboard"]') as HTMLAnchorElement;
    assert.equal(dashboard.textContent?.trim(), 'Dashboard');
    await act(async () => { dashboard.click(); await flush(); });
    assert.equal(app.router.state.location.pathname, '/dashboard');
  } finally { await app.cleanup(); }
});

test('landing navigation keeps Dashboard during a session refresh failure and restores guest actions after confirmed sign-out', async () => {
  const app = await setup('/', true);
  try {
    session = async () => { throw new TypeError('Failed to fetch'); };
    await app.focus();
    assert.ok(app.container.querySelector('a[href="/dashboard"]'));
    assert.equal(app.container.querySelector('a[href="/login"], a[href="/signup"]'), null);
    session = async () => ({ user: null });
    await app.focus();
    assert.equal(app.container.querySelector('a[href="/dashboard"]'), null);
    assert.ok(app.container.querySelector('a[href="/login"]'));
    assert.ok(app.container.querySelector('a[href="/signup"]'));
  } finally { await app.cleanup(); }
});

test('login and signup use a workspace loader then return an existing account to its dashboard destination', async () => {
  for (const route of ['/login', '/signup']) {
    let finish!: (result: unknown) => void;
    const returnTo = '/dashboard/contracts?stage=draft#document';
    const app = await setup(`${route}?next=${encodeURIComponent(returnTo)}`, false, false,
      () => new Promise(resolve => { finish = resolve; }));
    try {
      assert.match(app.container.textContent!, /Opening your workspace/);
      assert.doesNotMatch(app.container.textContent!, /Checking your sign-in/);
      assert.equal(app.container.querySelector('form'), null);
      await act(async () => { finish({ user: person }); await flush(); });
      const location = app.router.state.location;
      assert.equal(`${location.pathname}${location.search}${location.hash}`, returnTo);
      assert.equal(app.container.querySelector('form'), null);
    } finally { await app.cleanup(); }
  }
});

test('temporary session-service failures and malformed responses preserve the signed-in editor; confirmed expiry signs out', async () => {
  const app = await setup('/probe', true);
  try {
    await app.fill('input', 'Unsaved working text');
    session = async () => { throw new TypeError('Failed to fetch'); }; await app.focus();
    assert.match(app.container.textContent!, /Signed in/);
    assert.equal(app.container.querySelector('input')!.value, 'Unsaved working text');
    assert.match(app.container.textContent!, /could not reach the account service/);
    session = async () => ({}); await app.click('Retry');
    assert.match(app.container.textContent!, /incomplete response/);
    assert.equal(app.container.querySelector('input')!.value, 'Unsaved working text');
    session = async () => ({ user: person }); await app.click('Retry');
    assert.doesNotMatch(app.container.textContent!, /incomplete response/);
    session = async () => ({ user: null }); await app.focus();
    assert.match(app.container.textContent!, /Signed out/);
  } finally { await app.cleanup(); }
});

test('blocked local storage does not interrupt cookie login or logout', async () => {
  const app = await setup();
  const prototype = Object.getPrototypeOf(window.localStorage);
  const originals = Object.fromEntries(['getItem', 'setItem', 'removeItem'].map((name) => [name, prototype[name]]));
  for (const name of Object.keys(originals)) prototype[name] = () => { throw new Error('Storage blocked'); };
  try {
    await app.click('Login'); assert.match(app.container.textContent!, /Signed in/);
    await app.click('Logout'); assert.match(app.container.textContent!, /Signed out/);
    assert.doesNotMatch(app.container.textContent!, /Storage blocked/);
  } finally { Object.assign(prototype, originals); await app.cleanup(); }
});

test('a delayed session check cannot resurrect a session after an explicit expiry event', async () => {
  const app = await setup('/probe', true);
  try {
    let finish!: (value: unknown) => void;
    session = () => new Promise((resolve) => { finish = resolve; });
    await app.focus();
    await act(async () => window.dispatchEvent(new window.Event('own-masters-session-expired')));
    await act(async () => { finish({ user: person }); await flush(); });
    assert.match(app.container.textContent!, /Signed out/);
  } finally { await app.cleanup(); }
});

test('production signup validates confirmation and passphrases, preserves return paths, and has no demo controls', async () => {
  const app = await setup('/signup?next=%2Fdashboard%2Fcontracts');
  try {
    assert.doesNotMatch(app.container.textContent!, /Demo Admin|Development preview|local test inbox/);
    assert.equal(app.container.querySelector('a[href^="/resend-confirmation"]'), null);
    await app.fill('input[name="name"]', 'Owner'); await app.fill('input[name="email"]', 'owner@example.test');
    await app.fill('#password', 'short'); await app.fill('#confirm-password', 'short'); await app.submit();
    assert.match(app.container.textContent!, /at least 8/); assert.equal(posts.length, 0);
    for (const password of ['ABCDEF1!', 'abcdef1!', 'Abcdefg!', 'Abcdef12', 'Abcdef1 ']) {
      await app.fill('#password', password); await app.fill('#confirm-password', password); await app.submit();
      assert.match(app.container.textContent!, /Include at least one lowercase letter/); assert.equal(posts.length, 0);
    }
    await app.fill('#password', 'Abcdef1!'); await app.fill('#confirm-password', 'a different password'); await app.submit();
    assert.match(app.container.textContent!, /do not match/); assert.equal(posts.length, 0);
    await app.click('Show password');
    assert.equal(app.container.querySelector('#password')!.getAttribute('type'), 'text');
    await app.fill('#confirm-password', 'Abcdef1!'); await app.submit();
    assert.match(app.container.textContent!, /Check your email/);
    assert.equal(app.container.querySelector('summary')!.textContent, 'Didn’t receive the email?');
    assert.equal(app.container.querySelector('details')!.open, false);
    assert.ok(app.container.querySelector('a[href="/login?next=%2Fdashboard%2Fcontracts"]'));
  } finally { await app.cleanup(); }
});

test('password reset enforces the same eight-character combination before submitting', async () => {
  const app = await setup(`/reset-password#token=${'b'.repeat(64)}`);
  try {
    assert.equal(app.container.querySelector('#new-password')!.getAttribute('minlength'), '8');
    for (const password of ['Aa1!abc', 'ABCDEF1!', 'abcdef1!', 'Abcdefg!', 'Abcdef12', 'Abcdef1 ']) {
      await app.fill('#new-password', password); await app.fill('#confirm-password', password); await app.submit();
      assert.equal(posts.length, 0);
      assert.ok(app.container.querySelector('[role="alert"]'));
    }
    await app.fill('#new-password', 'New1!abc'); await app.fill('#confirm-password', 'New1!abc'); await app.submit();
    assert.equal(posts.at(-1), '/api/auth/reset-password');
    assert.match(app.container.textContent!, /Password updated/);
  } finally { await app.cleanup(); }
});

test('login can recover email-config failures, accepts existing shorter passwords, and returns to a protected destination', async () => {
  const app = await setup('/login?next=%2Fdashboard%2Fcontracts', false, true);
  try {
    assert.match(app.container.textContent!, /could not reach the account service/);
    session = async () => ({ user: null }); configurationFails = false; await app.click('Try again');
    assert.doesNotMatch(app.container.textContent!, /could not reach the account service/);
    assert.equal(app.container.querySelector('a[href^="/resend-confirmation"]'), null);
    await app.fill('input[name="email"]', 'owner@example.test'); await app.fill('#password', 'older-password');
    assert.equal(app.container.querySelector('input#password')!.getAttribute('minlength'), null);
    await app.submit(); assert.equal(app.router.state.location.pathname, '/dashboard/contracts');
  } finally { await app.cleanup(); }
});

test('resend appears only for an unconfirmed login and pre-fills the recovery address without putting it in the URL', async () => {
  const app = await setup('/login?next=%2Fdashboard%2Fcontracts');
  try {
    assert.equal(app.container.querySelector('a[href^="/resend-confirmation"]'), null);
    unconfirmedLogin = true;
    await app.fill('input[name="email"]', person.email); await app.fill('#password', 'Abcdef1!'); await app.submit();
    assert.ok(app.container.querySelector('a[href^="/resend-confirmation"]'));
    await app.fill('input[name="email"]', 'different@example.test');
    assert.equal(app.container.querySelector('a[href^="/resend-confirmation"]'), null);
    await app.fill('#password', 'Abcdef1!'); await app.submit();
    await act(async () => { (app.container.querySelector('a[href^="/resend-confirmation"]') as HTMLElement).click(); await flush(); });
    assert.equal(app.router.state.location.pathname, '/resend-confirmation');
    assert.equal(app.router.state.location.search, '?next=%2Fdashboard%2Fcontracts');
    assert.equal(app.container.querySelector('input[name="email"]')!.value, 'different@example.test');
    await app.submit(); assert.equal(posts.at(-1), '/api/auth/resend-confirmation');
  } finally { await app.cleanup(); }
});

test('email confirmation requires a deliberate click; malformed reset links offer a fresh-link action', async () => {
  const app = await setup(`/auth/confirm#token=${'a'.repeat(64)}`);
  try {
    assert.equal(confirmation, false); assert.equal(posts.length, 0);
    await app.click('Confirm email'); assert.equal(confirmation, true);
    assert.match(app.container.textContent!, /Email confirmed/);
    await act(async () => { await app.router.navigate('/reset-password#token=invalid'); await flush(); });
    assert.match(app.container.textContent!, /Request a new reset link/);
    assert.ok(app.container.querySelector('a[href="/forgot-password"]'));
  } finally { await app.cleanup(); }
});
