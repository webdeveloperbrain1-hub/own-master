import { Link } from 'react-router';
import { ArrowLeft, ArrowRight, Check, Music2, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useBilling } from '../billing/BillingContext';
import { proPriceLabel } from '../data/billingClient';
import EarlyAccess from '../components/EarlyAccess';
import SiteFooter from '../components/SiteFooter';

const button = 'micro-interaction inline-flex items-center justify-center gap-2 rounded-[14px] border border-border px-5 py-3 font-semibold hover:opacity-90';
export default function PricingPage() {
  const { user } = useAuth();
  const { catalog, status, loading, error, refresh } = useBilling();
  const preview = catalog?.mode === 'preview';
  return <main className="mx-auto max-w-[1000px] px-4 sm:px-6 pb-12 sm:pb-16">
    <header className="flex flex-wrap justify-between items-center gap-4 py-5 border-b border-border">
      <Link to="/" className="flex min-h-11 items-center gap-2 font-extrabold text-[18px]"><Music2 className="size-6" />Own Masters</Link>
      <Link className="inline-flex min-h-11 gap-2 items-center text-[14px]" to={user ? '/dashboard' : '/'}><ArrowLeft className="size-4 shrink-0" />{user ? 'Back to workspace' : 'Back to home'}</Link>
    </header>
    <section data-reveal className="pt-10 sm:pt-14 pb-7 sm:pb-9 text-center max-w-[720px] mx-auto">
      <p className="text-[12px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-4">Plans for your music business</p>
      <h1 className="text-[clamp(34px,6vw,58px)] font-bold tracking-[-1.5px] leading-[1.08]">Start with a draft.<br />Build your paper trail.</h1>
      <p className="mt-5 text-[17px] leading-relaxed text-muted-foreground">A place for your songs, agreements, and the details that matter. Choose the tools that fit your next step.</p>
    </section>
    {error && <div role="alert" className="rounded-[16px] border border-border p-4 mb-5 text-[14px]">{error} <button onClick={() => void refresh()} className="underline font-semibold">Refresh plans</button></div>}
    {!catalog ? <section role="status" className="rounded-[20px] border border-border bg-card p-6 text-center text-muted-foreground">{loading ? 'Loading access information…' : 'Access information is temporarily unavailable. Please refresh to try again.'}</section> : preview ? <EarlyAccess signedIn={Boolean(user)} /> : <><div data-reveal-group className="grid md:grid-cols-2 gap-5">
      <section className="motion-card min-w-0 rounded-[24px] border border-border bg-card p-5 sm:p-7 flex flex-col">
        <p className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground font-bold">The foundation</p><h2 className="text-[28px] font-bold mt-2">Free</h2>
        <p className="text-[32px] font-bold my-4">$0</p><p className="text-muted-foreground text-[14px] mb-6">Get your songs and agreements organized.</p>
        <ul className="grid gap-4 text-[14px] mb-8">{['Create and edit contract drafts', 'Organize song projects, lyrics, and notes', 'Track contract progress and signed copies', 'Read guides and reference resources'].map((value) => <li key={value} className="flex gap-3"><Check className="size-4 shrink-0 mt-0.5" />{value}</li>)}</ul>
        <Link className={`${button} mt-auto bg-muted`} to={user ? '/dashboard' : '/signup'}>{user ? 'Open workspace' : 'Start free'}<ArrowRight className="size-4" /></Link>
      </section>
      <section className="motion-card min-w-0 rounded-[24px] border-2 border-primary bg-card p-5 sm:p-7 flex flex-col relative">
        <p className="text-[12px] uppercase tracking-[0.15em] text-muted-foreground font-bold flex gap-2 items-center"><Sparkles className="size-4" />From draft to document</p><h2 className="text-[28px] font-bold mt-2">Pro</h2>
        <p className="text-[clamp(24px,4vw,32px)] font-bold my-4">{loading && !catalog ? 'Loading plans…' : proPriceLabel(catalog)}</p><p className="text-muted-foreground text-[14px] mb-6">Export your paperwork and keep it ready to share.</p>
        <ul className="grid gap-4 text-[14px] mb-8">{['Everything in Free', 'Export saved contracts as PDF and Word', 'Download original contract templates', 'Edit and re-download saved drafts', 'Manage your subscription and invoices'].map((value) => <li key={value} className="flex gap-3"><Check className="size-4 shrink-0 mt-0.5" />{value}</li>)}</ul>
        {catalog?.checkoutAvailable ? <Link className={`${button} mt-auto bg-primary text-primary-foreground`} to={user ? '/dashboard/billing?plan=pro' : `/signup?next=${encodeURIComponent('/dashboard/billing?plan=pro')}`}>{status?.plan === 'pro' ? 'Manage Pro' : 'Review Pro'}<ArrowRight className="size-4" /></Link> : <button className={`${button} mt-auto opacity-60`} disabled>Plans unavailable</button>}
      </section>
    </div>
    <section data-reveal-group className="grid sm:grid-cols-2 gap-7 mt-10 text-[14px]">
      <div><h2 className="font-bold mb-2">What happens to my drafts?</h2><p className="text-muted-foreground leading-relaxed">Your saved contracts stay in your account. Changing plans does not delete your documents, projects, or signed copies.</p></div>
      <div><h2 className="font-bold mb-2">When will I be charged?</h2><p className="text-muted-foreground leading-relaxed">{preview ? 'There is no checkout during early access. Prices will be announced before paid plans launch.' : 'You review the price and billing period in checkout before confirming a subscription. You can manage renewal from Billing.'}</p></div>
    </section></>}
    <SiteFooter />
  </main>;
}
