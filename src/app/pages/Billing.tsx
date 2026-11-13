import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, Check, CreditCard, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import EarlyAccess from '../components/EarlyAccess';
import AdministratorAccess from '../components/AdministratorAccess';
import { useBilling } from '../billing/BillingContext';
import { useLeaveConfirmation } from '../components/UnsavedChanges';
import { createBillingPortal, createCheckout, proPriceLabel, safeBillingReturn } from '../data/billingClient';

const button = 'micro-interaction inline-flex items-center justify-center gap-2 rounded-[14px] border border-border bg-muted px-4 py-3 text-[14px] font-semibold hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed';
const primary = `${button} bg-primary text-primary-foreground`;
const panel = 'min-w-0 rounded-[22px] border border-border bg-card p-5 sm:p-6';

export default function BillingPage() {
  const { catalog, status, loading, error, refresh, isAdmin } = useBilling();
  const [params] = useSearchParams();
  const requestLeave = useLeaveConfirmation();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const returned = params.get('checkout') === 'returned';
  const cancelled = params.get('checkout') === 'cancelled';
  const returnTo = safeBillingReturn(params.get('returnTo'));
  const preview = catalog?.mode === 'preview';
  const pro = status?.plan === 'pro';
  useEffect(() => {
    if (isAdmin || !returned || preview || pro) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (++attempts > 10) { window.clearInterval(timer); return; }
      void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [returned, preview, pro, refresh, isAdmin]);
  async function openPayment(action: 'checkout' | 'portal') {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      const result = action === 'checkout' ? await createCheckout(returnTo) : await createBillingPortal();
      const destination = new URL(result.url);
      if (destination.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(destination.hostname)) throw new Error('The payment page could not be opened. Please try again.');
      requestLeave(() => window.location.assign(destination.href));
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'Billing could not be opened.');
    } finally { setBusy(false); }
  }
  if (isAdmin) return <main className="grid gap-6">
    <header><h1 className="text-[30px] font-bold">Administrator access</h1></header>
    <AdministratorAccess />
    <Link to="/dashboard/account" className={`${button} justify-self-start`}>Account settings</Link>
  </main>;
  return <main className="grid gap-6">
    <header data-reveal className="flex flex-wrap gap-4 justify-between items-start">
      <div className="min-w-0"><p className="text-[12px] uppercase tracking-[0.16em] text-muted-foreground mb-2">Your account</p><h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight">{preview ? 'Your plan' : 'Plans & billing'}</h1><p className="text-muted-foreground mt-2">{preview ? 'Everything included in your Own Masters workspace.' : 'See your plan and manage your subscription in one place.'}</p></div>
      <button className={button} disabled={loading || busy} onClick={() => void refresh()}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />Refresh status</button>
    </header>
    {preview && <EarlyAccess signedIn account />}
    {!catalog && <section role="status" className={panel}>{loading ? 'Loading your plan…' : 'Your plan is temporarily unavailable. Please refresh to try again.'}</section>}
    {returned && !preview && <div role="status" className="rounded-[16px] border border-border bg-muted p-5 text-[14px]">{pro ? 'Your Pro subscription is active. You can return to your contract and export it.' : 'Waiting for payment confirmation. Your plan will update once payment is confirmed. Refresh the status if it is taking longer than expected.'}</div>}
    {cancelled && !preview && <p role="status" className="rounded-[16px] border border-border p-4 text-[14px]">You returned from checkout. Your billing status below shows whether a subscription is active; your saved drafts are still available.</p>}
    {(error || actionError) && <p role="alert" className="rounded-[16px] border border-destructive/50 p-4 text-[14px]">{actionError || error}</p>}
    {catalog?.mode === 'stripe' && <div data-reveal-group className="grid lg:grid-cols-[1fr_1fr] gap-5">
      <section className={panel}>
        <div className="flex justify-between items-center gap-3"><h2 className="font-bold text-[20px]">Current plan</h2><span className="rounded-full border border-border px-3 py-1 text-[12px] font-semibold">{preview ? 'Early access' : pro ? 'Pro' : status ? 'Free' : 'Loading'}</span></div>
        <p className="text-[32px] font-bold mt-6">{pro ? 'Own Masters Pro' : 'Your Own Masters workspace'}</p>
        <p className="text-muted-foreground text-[14px] leading-relaxed mt-3">{preview ? 'Keep creating, saving, and exporting contracts while paid plans are being prepared.' : pro ? 'Contract exports and original template downloads are included in your subscription.' : 'Create drafts, manage your song projects, and keep your contract progress organized.'}</p>
        {status?.subscriptionStatus && status.subscriptionStatus !== 'none' && <p className="mt-4 text-[14px]">Subscription: <strong>{status.subscriptionStatus.replace(/_/g, ' ')}</strong></p>}
        {status?.currentPeriodEnd && <p className="mt-2 text-[14px] text-muted-foreground">{status.cancelAtPeriodEnd ? 'Scheduled to end' : pro ? 'Current period ends' : 'Last recorded period ends'} {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(status.currentPeriodEnd))}.</p>}
        <div className="rounded-[14px] border border-border p-4 mt-6 text-[14px]"><CreditCard className="size-5 mb-2" /><strong>Payment methods & invoices</strong><p className="text-muted-foreground mt-1 mb-4">{status?.portalAvailable ? 'Open your billing portal to manage payment details, invoices, and renewal.' : 'Payment methods and invoices will appear after billing is set up for your account.'}</p><button className={button} disabled={busy || loading || !status?.portalAvailable} onClick={() => void openPayment('portal')}>Manage billing <ArrowUpRight className="size-4" /></button></div>
      </section>
      <section className={`${panel} border-primary/50`}>
        <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.15em] text-muted-foreground"><Sparkles className="size-4" />Own Masters Pro</p>
        <h2 className="text-[29px] font-bold tracking-tight mt-4">Finish the paperwork.</h2>
        <p className="text-[26px] font-bold my-5">{proPriceLabel(catalog)}</p>
        <ul className="grid gap-4 text-[14px] mb-7">{['Everything in your Free workspace', 'Export saved contracts as PDF and Word', 'Download original contract templates', 'Keep editing and re-download your saved drafts'].map((feature) => <li className="flex gap-3" key={feature}><Check className="size-4 shrink-0 mt-0.5" />{feature}</li>)}</ul>
        <button className={`${primary} w-full`} disabled={busy || loading || !catalog?.checkoutAvailable || !status?.checkoutAvailable || pro || Boolean(error)} onClick={() => void openPayment('checkout')}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{pro ? 'Pro is active' : 'Continue to secure checkout'}</button>
        {!preview && catalog?.checkoutAvailable && <p className="text-[12px] text-muted-foreground leading-relaxed mt-3">Review the recurring price and billing period on Stripe before subscribing. Card details are entered on Stripe.</p>}
        <Link to="/pricing" className="inline-block underline text-[13px] mt-5">Compare plans</Link>
      </section>
    </div>}
    <section data-reveal className={`${panel} flex flex-wrap items-center justify-between gap-4`}><div className="flex gap-3 items-start"><FileText className="size-5 mt-1 shrink-0" /><div><h2 className="font-bold">Your work stays with you.</h2><p className="text-[14px] text-muted-foreground mt-1">Your saved drafts, projects, and signed copies stay in your account when you change plans.</p></div></div><Link to={returnTo} className={button}><ArrowLeft className="size-4" />Back to workspace</Link></section>
  </main>;
}
