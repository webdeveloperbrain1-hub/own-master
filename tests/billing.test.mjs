import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import Stripe from 'stripe';
import { prisma } from '../server/lib/prisma.mjs';
import { loadEnv } from '../server/lib/env.mjs';
import { billingConfig, billingReturnPath, subscriptionAllowsExports } from '../server/lib/billing/billingConfig.mjs';
import { createBillingService } from '../server/lib/billing/billingService.mjs';
import { handleBillingRoutes } from '../server/lib/billing/billingApi.mjs';
import { handleFilingRoutes } from '../server/lib/contractFiling/filingApi.mjs';
import { billing } from '../server/lib/billing/billingService.mjs';

loadEnv();
after(() => prisma.$disconnect());
const env = { BILLING_MODE: 'stripe', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PRO_PRICE_ID: 'price_pro', APP_ORIGIN: 'http://127.0.0.1:5174', NODE_ENV: 'test' };
const auth = (id) => ({ user: { id, email: `${id}@example.test`, app_metadata: { role: 'member' } }, isDemo: false });

test('preview is the default and cannot create payments, paid status, or contact Stripe', async () => {
  const service = createBillingService({ env: {}, db: {}, stripeFactory: () => { throw new Error('Must never contact Stripe'); } });
  assert.equal(billingConfig({}).mode, 'preview');
  assert.equal((await service.catalog()).price, null);
  assert.deepEqual(await service.status(auth('preview')), { mode: 'preview', plan: 'free', canExport: true, checkoutAvailable: false, portalAvailable: false, subscriptionStatus: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false });
  await service.requireExports(auth('preview'));
  await assert.rejects(service.checkout(auth('preview'), { plan: 'pro' }), { code: 'billing_unavailable' });
  await assert.rejects(service.portal(auth('preview')), { code: 'billing_unavailable' });
  await assert.rejects(service.webhook(Buffer.from('{}'), 'forged'), { code: 'billing_unavailable' });
  assert.throws(() => billingConfig({ BILLING_MODE: 'stripe' }), /requires/);
  assert.throws(() => billingConfig({ BILLING_MODE: 'typo' }), /BILLING_MODE/);
  assert.throws(() => billingConfig({ ...env, NODE_ENV: 'production' }), /HTTPS/);
  for (const path of ['https://evil.test/dashboard', '//evil.test/dashboard', '/\\evil.test/dashboard', '/dashboard/../../login', '/dashboard\n'])
    assert.equal(billingReturnPath(path), '/dashboard/contracts');
  assert.equal(billingReturnPath('/dashboard/contracts/drafts/one/edit?project=two#document'), '/dashboard/contracts/drafts/one/edit?project=two#document');
  assert.equal(subscriptionAllowsExports({ subscriptionStatus: 'active', stripePriceId: 'price_pro', currentPeriodEnd: new Date(0) }), false);
});

test('Checkout uses authenticated owners, configured price, one open session, and the matching portal customer', async () => {
  const users = [`billing-${randomUUID()}`, `billing-${randomUUID()}`];
  const calls = { customers: [], checkouts: [], portals: [] };
  const sessions = new Map();
  let subscriptions = [];
  const api = {
    prices: { retrieve: async () => ({ id: 'price_pro', active: true, type: 'recurring', billing_scheme: 'per_unit', unit_amount: 1900, currency: 'usd', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }) },
    customers: { create: async (input) => { calls.customers.push(input); return { id: `cus_${randomUUID()}` }; } },
    subscriptions: { list: async () => ({ data: subscriptions, has_more: false }) },
    checkout: { sessions: {
      retrieve: async (id) => sessions.get(id),
      create: async (input) => { calls.checkouts.push(input); const session = { id: `cs_${randomUUID()}`, status: 'open', url: 'https://checkout.stripe.com/c/pay/test' }; sessions.set(session.id, session); return session; },
    } },
    billingPortal: { sessions: { create: async (input) => { calls.portals.push(input); return { url: 'https://billing.stripe.com/p/session/test' }; } } },
  };
  const service = createBillingService({ env, stripeFactory: () => api });
  try {
    for (const id of users) await prisma.accountUser.create({ data: { id, email: `${id}@example.test`, name: 'Billing test', passwordHash: 'unused' } });
    const input = { plan: 'pro', priceId: 'price_attacker', customer: 'cus_victim', userId: users[1], returnTo: '//evil.test/dashboard' };
    const results = await Promise.all([service.checkout(auth(users[0]), input), service.checkout(auth(users[0]), input)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(calls.customers.length, 1); assert.equal(calls.checkouts.length, 1);
    assert.equal(calls.customers[0].email, `${users[0]}@example.test`);
    assert.equal(calls.checkouts[0].line_items[0].price, 'price_pro');
    assert.equal(calls.checkouts[0].client_reference_id, users[0]);
    assert.ok(calls.checkouts[0].success_url.startsWith('http://127.0.0.1:5174/dashboard/billing?'));
    assert.ok(!calls.checkouts[0].success_url.includes('evil.test'));
    await assert.rejects(service.portal(auth(users[1])), { status: 409 });
    await service.portal(auth(users[0]));
    assert.equal(calls.portals[0].customer, calls.checkouts[0].customer);
    await assert.rejects(service.requireExports(auth(users[0])), { status: 402 });
    subscriptions = [{ id: 'sub_existing', status: 'past_due' }];
    await assert.rejects(service.checkout(auth(users[0]), input), { code: 'subscription_exists' });
    // An expired or previously completed session must not trap re-subscriptions.
    subscriptions = [];
    for (const session of sessions.values()) session.status = 'complete';
    await service.checkout(auth(users[0]), input);
    assert.equal(calls.checkouts.length, 2);
    await assert.rejects(service.requireExports({ ...auth(users[0]), isDemo: true }), { status: 402 });
  } finally { await prisma.accountUser.deleteMany({ where: { id: { in: users } } }); }
});

test('signed webhook HTTP processing rejects forgeries and reconciles duplicates, old events, failures, cancellation and expiry', async () => {
  const userId = `billing-${randomUUID()}`, otherId = `billing-${randomUUID()}`;
  const customer = `cus_${randomUUID()}`, subscriptionId = `sub_${randomUUID()}`;
  const eventIds = [];
  const signer = new Stripe(env.STRIPE_SECRET_KEY);
  let current = { id: subscriptionId, customer, status: 'incomplete', cancel_at_period_end: false, pause_collection: null,
    items: { data: [{ price: { id: 'price_pro' }, current_period_end: Math.floor(Date.now() / 1000) + 3600 }] } };
  const service = createBillingService({ env, stripeFactory: () => ({ webhooks: signer.webhooks, subscriptions: { retrieve: async () => current } }) });
  let authCalls = 0;
  const server = createServer(async (req, res) => {
    const ctx = { url: new URL(req.url, 'http://localhost'), sendJson: (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); },
      requireAuth: async () => { authCalls++; if (req.headers['x-test-user'] !== userId) throw Object.assign(new Error('Sign in'), { status: 401 }); return auth(userId); },
      readBody: async () => { throw new Error('Webhook must not use parsed JSON'); } };
    await handleBillingRoutes(req, res, ctx, service);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const event = (type, object = { customer, subscription: subscriptionId }) => ({ id: `evt_${randomUUID()}`, type, data: { object } });
  async function deliver(value, valid = true) {
    eventIds.push(value.id);
    const payload = JSON.stringify(value, null, 2);
    const signature = signer.webhooks.generateTestHeaderString({ payload, secret: valid ? env.STRIPE_WEBHOOK_SECRET : 'whsec_wrong' });
    return fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'Stripe-Signature': signature, 'Content-Type': 'application/json' }, body: payload });
  }
  try {
    for (const id of [userId, otherId]) await prisma.accountUser.create({ data: { id, email: `${id}@example.test`, name: 'Billing test', passwordHash: 'unused' } });
    await prisma.billingAccount.create({ data: { userId, stripeCustomerId: customer } });
    const completed = event('checkout.session.completed');
    assert.equal((await deliver(completed, false)).status, 400);
    assert.equal(await prisma.billingWebhookEvent.count({ where: { id: completed.id } }), 0);
    assert.equal((await deliver(completed)).status, 200);
    assert.equal((await service.status(auth(userId))).canExport, false, 'incomplete is not paid');
    current.status = 'active';
    assert.equal((await deliver(completed)).status, 200);
    assert.equal((await service.status(auth(userId))).canExport, false, 'same event cannot be processed twice');
    assert.equal((await deliver(event('invoice.paid'))).status, 200);
    assert.equal((await service.status(auth(userId))).plan, 'pro');
    assert.equal((await service.status(auth(otherId))).canExport, false);
    await service.requireExports(auth(userId));
    current.cancel_at_period_end = true;
    await deliver(event('customer.subscription.updated', { ...current, status: 'old-snapshot' }));
    assert.equal((await service.status(auth(userId))).canExport, true);
    assert.equal((await service.status(auth(userId))).cancelAtPeriodEnd, true);
    current.status = 'past_due';
    await deliver(event('invoice.payment_failed'));
    await assert.rejects(service.requireExports(auth(userId)), { code: 'upgrade_required' });
    // Stale paid snapshots never restore a currently canceled subscription.
    current.status = 'canceled';
    await deliver(event('customer.subscription.updated', { ...current, status: 'active' }));
    assert.equal((await service.status(auth(userId))).plan, 'free');
    current.status = 'active'; current.items.data[0].price.id = 'price_not_pro';
    await deliver(event('customer.subscription.updated', current));
    assert.equal((await service.status(auth(userId))).canExport, false);
    current.items.data[0].price.id = 'price_pro'; current.items.data[0].current_period_end = Math.floor(Date.now() / 1000) - 1;
    await deliver(event('customer.subscription.updated', current));
    assert.equal((await service.status(auth(userId))).canExport, false);
    const unknown = event('checkout.session.completed', { customer: 'cus_unknown', subscription: 'sub_unknown', metadata: { ownMastersUserId: otherId } });
    await deliver(unknown);
    assert.equal(await prisma.billingAccount.count({ where: { userId: otherId } }), 0);
    assert.equal(authCalls, 0, 'signed webhooks never use browser authentication');
    assert.equal((await fetch(`${base}/api/billing/status`)).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.billingWebhookEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.accountUser.deleteMany({ where: { id: { in: [userId, otherId] } } });
  }
});

test('paid export endpoint checks ownership first, denies Free, and preserves preview export access', async () => {
  const owner = `billing-${randomUUID()}`, other = `billing-${randomUUID()}`;
  let template, draft;
  const previous = billing.requireExports;
  const guarded = createBillingService({ env });
  const server = createServer(async (req, res) => {
    const sendJson = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    try { await handleFilingRoutes(req, res, { url: new URL(req.url, 'http://localhost'), sendJson,
      requireAuth: async () => auth(req.headers['x-test-user'] || other), readBody: async () => ({}) }); }
    catch (error) { sendJson(res, error.status || 500, { code: error.code }); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    template = await prisma.contractFile.create({ data: { originalName: 'Billing fixture.txt', originalPath: 'test', storedPath: 'test', extension: '.txt', sizeBytes: 20, sha256: randomUUID(), extractedText: 'AGREEMENT\n\nOwner and Artist agree to the terms.' } });
    draft = await prisma.contractDraft.create({ data: { userId: owner, templateId: template.id, name: 'Billing export test', values: {}, renderedText: template.extractedText } });
    const route = `http://127.0.0.1:${server.address().port}/api/filing/drafts/${draft.id}/download?format=pdf`;
    billing.requireExports = guarded.requireExports;
    assert.equal((await fetch(route)).status, 404);
    const denied = await fetch(route, { headers: { 'X-Test-User': owner } });
    assert.equal(denied.status, 402); assert.equal((await denied.json()).code, 'upgrade_required');
    assert.ok(await prisma.contractDraft.findUnique({ where: { id: draft.id } }), 'upgrade never deletes a draft');
    billing.requireExports = createBillingService({ env: {} }).requireExports;
    const allowed = await fetch(route, { headers: { 'X-Test-User': owner } });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('Content-Type'), 'application/pdf');
  } finally {
    billing.requireExports = previous;
    await new Promise((resolve) => server.close(resolve));
    if (draft) await prisma.contractDraft.deleteMany({ where: { id: draft.id } });
    if (template) await prisma.contractFile.deleteMany({ where: { id: template.id } });
  }
});
