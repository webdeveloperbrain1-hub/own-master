import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Check, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { fetchBillingCatalog, fetchBillingStatus, proPriceLabel, type BillingCatalog, type BillingStatus } from '../data/billingClient';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';

type BillingContextValue = {
  catalog: BillingCatalog | null; status: BillingStatus | null; loading: boolean; error: string;
  refresh: () => Promise<void>; showUpgrade: () => void;
};
const Context = createContext<BillingContextValue>({ catalog: null, status: null, loading: false, error: '', refresh: async () => {}, showUpgrade: () => {} });
const button = 'micro-interaction inline-flex items-center justify-center gap-2 rounded-[14px] border border-border bg-muted px-4 py-3 font-semibold hover:bg-accent';

export function BillingProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id || '';
  const [data, setData] = useState<{ owner: string; catalog: BillingCatalog | null; status: BillingStatus | null }>({ owner: '', catalog: null, status: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const version = useRef(0);
  const location = useLocation();
  const catalog = data.catalog;
  const status = data.owner === owner ? data.status : null;
  const refresh = useCallback(async () => {
    if (authLoading) return;
    const request = ++version.current;
    setLoading(true);
    const [plans, account] = await Promise.allSettled([fetchBillingCatalog(), owner ? fetchBillingStatus() : Promise.resolve(null)]);
    if (version.current !== request) return;
    setData((current) => ({ owner, catalog: plans.status === 'fulfilled' ? plans.value : current.catalog,
      status: account.status === 'fulfilled' ? account.value : current.owner === owner ? current.status : null }));
    setError(plans.status === 'rejected' || account.status === 'rejected' ? 'Billing is temporarily unavailable. Please refresh to try again.' : '');
    setLoading(false);
  }, [owner, authLoading]);
  useEffect(() => {
    setOpen(false);
    void refresh();
    const focus = () => { void refresh(); };
    const upgrade = () => setOpen(true);
    window.addEventListener('focus', focus);
    window.addEventListener('own-masters-upgrade-required', upgrade);
    return () => { version.current++; window.removeEventListener('focus', focus); window.removeEventListener('own-masters-upgrade-required', upgrade); };
  }, [refresh]);
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return <Context.Provider value={{ catalog, status, loading, error, refresh, showUpgrade: () => setOpen(true) }}>
    {children}
    {catalog?.mode === 'stripe' && <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[480px] rounded-[22px] max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <Sparkles className="size-8 mb-2 text-primary" />
          <DialogTitle className="text-[26px]">Your next step with Pro</DialogTitle>
          <DialogDescription>Keep the paperwork moving, from your first draft to an exported agreement.</DialogDescription>
        </DialogHeader>
        <p className="text-[23px] font-bold">{proPriceLabel(catalog)}</p>
        <ul className="grid gap-3 text-[14px]">
          {['Export saved contracts as PDF or Word', 'Download original contract templates', 'Keep editing and re-download your saved drafts'].map((feature) => <li className="flex gap-2" key={feature}><Check className="size-4 shrink-0 mt-0.5" />{feature}</li>)}
        </ul>
        {!catalog && <p role="status" className="text-[14px] text-muted-foreground">Plan information is currently unavailable. Please try again shortly.</p>}
        <div className="flex flex-wrap gap-2">
          <Link className={button} to="/pricing" onClick={() => setOpen(false)}>Compare plans</Link>
          {catalog?.checkoutAvailable && <Link className={`${button} bg-primary text-primary-foreground`} to={`/dashboard/billing?plan=pro&returnTo=${encodeURIComponent(returnTo)}`} onClick={() => setOpen(false)}>Review Pro</Link>}
        </div>
      </DialogContent>
    </Dialog>}
  </Context.Provider>;
}

export const useBilling = () => useContext(Context);

export function ProExportNotice() {
  const { catalog, status, showUpgrade } = useBilling();
  if (!catalog || catalog.mode === 'preview' || status?.plan === 'pro') return null;
  return <aside data-reveal className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-muted p-4 text-[14px]">
    <div><strong>Take your contracts further with Pro.</strong><p className="text-muted-foreground mt-1">PDF and Word exports are included in Pro. You can keep drafting on Free.</p></div>
    <button type="button" className={button} onClick={showUpgrade}><Sparkles className="size-4" />View Pro</button>
  </aside>;
}
