import { Link } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';

const features = [
  'Create, edit and save contract drafts',
  'Download contracts as PDF and Word documents',
  'Organize song projects, audio, lyrics and notes',
  'Keep related contracts with each song',
  'Track contract progress and store signed PDFs',
  'Read the guides and reference library',
];

export default function EarlyAccess({ signedIn, account = false }: { signedIn: boolean; account?: boolean }) {
  return <section className="mx-auto w-full max-w-[720px] rounded-[24px] border border-primary/40 bg-card p-5 sm:p-8" aria-labelledby="early-access-title">
    <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Own Masters</p>
    <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="early-access-title" className="text-[28px] font-bold">{account ? 'Your early-access plan' : 'Free early access'}</h2><p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">A workspace for your songs and agreements. No payment or card details are required.</p></div>
      <p className="text-[36px] font-bold">$0</p>
    </div>
    <ul className="my-7 grid gap-4 text-[14px]">{features.map(feature => <li key={feature} className="flex items-start gap-3"><Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />{feature}</li>)}</ul>
    <p className="mb-6 text-[13px] leading-relaxed text-muted-foreground">If paid plans are introduced, their prices and included features will be explained before you choose a subscription.</p>
    <Link className="micro-interaction inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-primary px-5 py-3 font-semibold text-primary-foreground hover:opacity-90" to={signedIn ? '/dashboard' : '/signup'}>{signedIn ? 'Open your workspace' : 'Create free account'}<ArrowRight className="size-4" aria-hidden="true" /></Link>
  </section>;
}
