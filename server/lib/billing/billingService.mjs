import Stripe from 'stripe';
import { prisma } from '../prisma.mjs';
import { billingConfig, billingError, billingReturnPath, subscriptionAllowsExports } from './billingConfig.mjs';

const referenceId = (value) => typeof value === 'string' ? value : value?.id;
const liveSubscription = (subscription) => !['canceled', 'incomplete_expired'].includes(subscription.status);
const supportedEvents = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed',
  'invoice.paid', 'invoice.payment_failed',
]);

export function createBillingService({ db = prisma, env = process.env, stripeFactory = (key) => new Stripe(key, { maxNetworkRetries: 1, timeout: 10000 }), now = () => new Date() } = {}) {
  let client, clientKey, cachedPrice, priceKey, priceExpires = 0;
  const config = () => billingConfig(env);
  function stripe() {
    const settings = config();
    if (settings.mode !== 'stripe') throw billingError('Payments are not available yet. No payment has been taken.', 503, 'billing_unavailable');
    if (clientKey !== settings.secretKey) { client = stripeFactory(settings.secretKey); clientKey = settings.secretKey; }
    return client;
  }
  async function proPrice() {
    const settings = config();
    if (priceKey !== settings.priceId || priceExpires < now().getTime()) {
      const price = await stripe().prices.retrieve(settings.priceId);
      if (!price.active || price.type !== 'recurring' || price.billing_scheme !== 'per_unit' || price.unit_amount === null || price.recurring?.usage_type !== 'licensed')
        throw billingError('Pro is temporarily unavailable. Please try again later.', 503, 'billing_unavailable');
      cachedPrice = price; priceKey = settings.priceId; priceExpires = now().getTime() + 60000;
    }
    return cachedPrice;
  }
  async function catalog() {
    const settings = config();
    const price = settings.mode === 'stripe' ? await proPrice() : null;
    return {
      mode: settings.mode, checkoutAvailable: settings.mode === 'stripe',
      price: price ? { amount: price.unit_amount, currency: price.currency, interval: price.recurring.interval, intervalCount: price.recurring.interval_count } : null,
    };
  }
  function withAccount(userId, work) {
    return db.$transaction(async (tx) => {
      // Serialize Checkout creation and webhook reconciliation for this owner.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${userId}`}))::text`;
      const account = await tx.billingAccount.upsert({ where: { userId }, create: { userId }, update: {} });
      return work(tx, account);
    }, { maxWait: 10000, timeout: 45000 });
  }
  const internal = (auth) => auth.user.app_metadata?.role === 'admin';
  async function status(auth) {
    if (internal(auth)) return {
      mode: env.BILLING_MODE === 'stripe' ? 'stripe' : 'preview', plan: 'admin',
      canExport: true, checkoutAvailable: false, portalAvailable: false,
      subscriptionStatus: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false,
    };
    const settings = config();
    const account = settings.mode === 'stripe' ? await db.billingAccount.findUnique({ where: { userId: auth.user.id } }) : null;
    const pro = subscriptionAllowsExports(account, now()) && account.stripePriceId === settings.priceId;
    return {
      mode: settings.mode, plan: pro ? 'pro' : 'free',
      canExport: settings.mode === 'preview' || internal(auth) || pro,
      checkoutAvailable: settings.mode === 'stripe' && !internal(auth),
      portalAvailable: settings.mode === 'stripe' && Boolean(account?.stripeCustomerId),
      subscriptionStatus: account?.subscriptionStatus || 'none',
      currentPeriodEnd: account?.currentPeriodEnd || null,
      cancelAtPeriodEnd: account?.cancelAtPeriodEnd || false,
    };
  }
  async function requireExports(auth) {
    if (internal(auth)) return;
    if (!(await status(auth)).canExport) throw billingError('Contract exports are included in Pro. Your draft is saved; view plans to upgrade.', 402, 'upgrade_required');
  }
  async function checkout(auth, input = {}) {
    if (internal(auth)) throw billingError('Administrator accounts have full access without a subscription.', 400, 'admin_access');
    if (input.plan !== 'pro') throw billingError('Choose the Pro plan.');
    const settings = config(), api = stripe();
    await proPrice();
    return withAccount(auth.user.id, async (tx, account) => {
      let customerId = account.stripeCustomerId;
      if (!customerId) {
        const customer = await api.customers.create({ email: auth.user.email, metadata: { ownMastersUserId: auth.user.id } }, { idempotencyKey: `own-masters-customer-${auth.user.id}` });
        customerId = customer.id;
        account = await tx.billingAccount.update({ where: { userId: auth.user.id }, data: { stripeCustomerId: customerId } });
      }
      const subscriptions = await api.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      if (subscriptions.has_more) throw billingError('Please use Manage billing to review your subscriptions.', 409, 'subscription_exists');
      if (subscriptions.data.some(liveSubscription)) throw billingError('You already have a subscription or a payment awaiting completion. Use Manage billing.', 409, 'subscription_exists');
      if (account.checkoutSessionId) {
        const existing = await api.checkout.sessions.retrieve(account.checkoutSessionId);
        if (existing.status === 'open' && existing.url) return { url: existing.url };
      }
      const returnTo = billingReturnPath(input.returnTo);
      const session = await api.checkout.sessions.create({
        mode: 'subscription', customer: customerId, client_reference_id: auth.user.id,
        line_items: [{ price: settings.priceId, quantity: 1 }],
        subscription_data: { metadata: { ownMastersUserId: auth.user.id } },
        success_url: `${settings.origin}/dashboard/billing?checkout=returned&returnTo=${encodeURIComponent(returnTo)}`,
        cancel_url: `${settings.origin}/dashboard/billing?checkout=cancelled&returnTo=${encodeURIComponent(returnTo)}`,
        expires_at: Math.floor(now().getTime() / 1000) + 1800,
      }, { idempotencyKey: `own-masters-checkout-${auth.user.id}-${account.checkoutSessionId || 'first'}-${settings.priceId}` });
      await tx.billingAccount.update({ where: { userId: auth.user.id }, data: { checkoutSessionId: session.id } });
      return { url: session.url };
    });
  }
  async function portal(auth) {
    if (internal(auth)) throw billingError('Administrator accounts have full access without a subscription.', 400, 'admin_access');
    const api = stripe();
    const account = await db.billingAccount.findUnique({ where: { userId: auth.user.id } });
    if (!account?.stripeCustomerId) throw billingError('There is no billing account to manage yet.', 409);
    const session = await api.billingPortal.sessions.create({ customer: account.stripeCustomerId, return_url: `${config().origin}/dashboard/billing` });
    return { url: session.url };
  }
  async function processEvent(event) {
    if (!supportedEvents.has(event.type)) return;
    const object = event.data.object;
    const customerId = referenceId(object.customer);
    if (!customerId) return;
    const owner = await db.billingAccount.findUnique({ where: { stripeCustomerId: customerId } });
    if (!owner) return; // Never attach billing by an email or client-provided metadata.
    await withAccount(owner.userId, async (tx, account) => {
      if (await tx.billingWebhookEvent.findUnique({ where: { id: event.id } })) return;
      let subscriptionId = event.type.startsWith('customer.subscription.') ? object.id :
        referenceId(object.subscription) || referenceId(object.parent?.subscription_details?.subscription);
      subscriptionId ||= account.stripeSubscriptionId;
      if (subscriptionId) {
        const api = stripe();
        // Fetch current state while holding the owner lock, so a delayed older
        // event cannot restore access after cancellation or a failed renewal.
        if (account.stripeSubscriptionId && account.stripeSubscriptionId !== subscriptionId) {
          const current = await api.subscriptions.retrieve(account.stripeSubscriptionId);
          if (liveSubscription(current)) subscriptionId = current.id;
        }
        const subscription = await api.subscriptions.retrieve(subscriptionId);
        if (referenceId(subscription.customer) !== customerId) throw billingError('Subscription customer mismatch.', 400);
        const item = subscription.items.data.find((entry) => entry.price.id === config().priceId);
        const period = item?.current_period_end || subscription.current_period_end || subscription.trial_end;
        await tx.billingAccount.update({ where: { userId: owner.userId }, data: {
          stripeSubscriptionId: subscription.id, stripePriceId: item?.price.id || null,
          subscriptionStatus: subscription.status, accessPaused: Boolean(subscription.pause_collection),
          currentPeriodEnd: period ? new Date(period * 1000) : null,
          cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        } });
      }
      await tx.billingWebhookEvent.create({ data: { id: event.id, type: event.type } });
    });
  }
  async function webhook(rawBody, signature) {
    let event;
    try { event = stripe().webhooks.constructEvent(rawBody, signature, config().webhookSecret); }
    catch (error) {
      if (error.code === 'billing_unavailable') throw error;
      throw billingError('Invalid payment notification signature.', 400, 'invalid_webhook_signature');
    }
    await processEvent(event);
    return { received: true };
  }
  return { catalog, status, requireExports, checkout, portal, webhook };
}

export const billing = createBillingService();
