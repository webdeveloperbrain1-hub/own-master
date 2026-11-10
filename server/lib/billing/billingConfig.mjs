import { loadEnv } from '../env.mjs';

export function billingConfig(env = process.env) {
  if (env === process.env) loadEnv();
  const mode = env.BILLING_MODE || 'preview';
  if (!['preview', 'stripe'].includes(mode)) throw new Error('BILLING_MODE must be preview or stripe.');
  const config = {
    mode,
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    priceId: env.STRIPE_PRO_PRICE_ID || '',
    origin: env.APP_ORIGIN || 'http://127.0.0.1:5174',
  };
  if (mode === 'stripe') {
    if (!/^sk_(test|live)_\S+$/.test(config.secretKey) || !/^whsec_\S+$/.test(config.webhookSecret) || !/^price_\S+$/.test(config.priceId))
      throw new Error('Stripe billing requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_PRO_PRICE_ID.');
    const url = new URL(config.origin);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))))
      throw new Error('Stripe billing requires a trusted APP_ORIGIN (HTTPS in production).');
    config.origin = url.origin;
  }
  return config;
}

export function billingReturnPath(value) {
  // Never accept a customer-provided origin, protocol-relative URL, or backslash.
  if (typeof value !== 'string' || value.length > 1000 || /[\\\r\n]/.test(value)) return '/dashboard/contracts';
  try {
    const url = new URL(value, 'https://ownmasters.invalid');
    if (!value.startsWith('/') || url.origin !== 'https://ownmasters.invalid' ||
      !(url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/'))) return '/dashboard/contracts';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/dashboard/contracts'; }
}

export const billingError = (message, status = 400, code = 'billing_error') => Object.assign(new Error(message), { status, code });

export function subscriptionAllowsExports(account, now = new Date()) {
  return Boolean(account && !account.accessPaused && account.stripePriceId &&
    ['active', 'trialing'].includes(account.subscriptionStatus) &&
    account.currentPeriodEnd && new Date(account.currentPeriodEnd) > now);
}
