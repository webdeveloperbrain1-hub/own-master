import { apiJson } from './apiClient';

export interface BillingCatalog {
  mode: 'preview' | 'stripe';
  checkoutAvailable: boolean;
  price: { amount: number; currency: string; interval: string; intervalCount: number } | null;
}
export interface BillingStatus {
  mode: 'preview' | 'stripe';
  plan: 'free' | 'pro';
  canExport: boolean;
  checkoutAvailable: boolean;
  portalAvailable: boolean;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}
export const fetchBillingCatalog = () => apiJson<BillingCatalog>('/api/billing/catalog');
export const fetchBillingStatus = () => apiJson<BillingStatus>('/api/billing/status');
export const createCheckout = (returnTo: string) => apiJson<{ url: string }>('/api/billing/checkout', { plan: 'pro', returnTo });
export const createBillingPortal = () => apiJson<{ url: string }>('/api/billing/portal', {});

export function proPriceLabel(catalog: BillingCatalog | null) {
  if (!catalog) return 'Pricing unavailable';
  if (!catalog.price) return catalog.mode === 'preview' ? 'Free early access' : 'Pricing unavailable';
  const { amount, currency, interval, intervalCount } = catalog.price;
  const formatter = new Intl.NumberFormat('en', { style: 'currency', currency: currency.toUpperCase() });
  // Stripe charges ISK and UGX using two decimal places for API compatibility.
  const digits = ['isk', 'ugx'].includes(currency.toLowerCase()) ? 2 : formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return `${formatter.format(amount / 10 ** digits)} / ${intervalCount === 1 ? interval : `${intervalCount} ${interval}s`}`;
}

export function safeBillingReturn(value: string | null) {
  if (!value || /[\\\r\n]/.test(value) || value.length > 1000) return '/dashboard/contracts';
  try {
    const url = new URL(value, window.location.origin);
    if (!value.startsWith('/') || url.origin !== window.location.origin || !(url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')))
      return '/dashboard/contracts';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/dashboard/contracts'; }
}
