import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

const action = 'micro-interaction inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-primary bg-primary px-4 py-2.5 text-[14px] font-bold text-primary-foreground hover:opacity-90';
const navLink = 'inline-flex min-h-11 items-center rounded-[12px] px-3 py-2 text-[14px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export default function LandingNavigation({ onSection }: { onSection: (id: string) => void }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [pathname, user?.id]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    };
    const desktop = window.matchMedia('(min-width: 1024px)');
    const resize = () => { if (desktop.matches) setOpen(false); };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    desktop.addEventListener('change', resize);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); desktop.removeEventListener('change', resize); };
  }, [open]);
  function section(id: string) { setOpen(false); onSection(id); }

  return <header ref={header} className="border-b border-border py-3 sm:py-4">
    <div className="flex min-w-0 items-center justify-between gap-3">
      <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2 whitespace-nowrap text-[16px] font-[850] tracking-[-0.3px] sm:text-[18px]">
        <img src="/own-masters-logo.png" alt="Own Masters logo" className="w-10 shrink-0 h-auto brightness-0 dark:brightness-100 sm:w-14" />
        Own Masters
      </Link>
      <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
        <Link to="/pricing" className={navLink}>Pricing</Link>
        <button type="button" onClick={() => section('about')} className={navLink}>About</button>
        <button type="button" onClick={() => section('how-it-works')} className={navLink}>How it works</button>
        {!user && <Link to="/login" className={navLink}>Log in</Link>}
        <Link to={user ? '/dashboard' : '/signup'} className={`${action} ml-2`}>{user ? 'Go to Dashboard' : 'Sign Up'}{user && <ArrowRight className="size-4" aria-hidden="true" />}</Link>
      </nav>
      <div className="flex shrink-0 items-center gap-2 lg:hidden">
        <div className="hidden sm:block"><Link to={user ? '/dashboard' : '/signup'} className={action}>{user ? 'Dashboard' : 'Sign Up'}</Link></div>
        <button ref={toggle} type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] border border-border bg-muted hover:bg-accent" aria-label={open ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={open} aria-controls="mobile-site-menu" onClick={() => setOpen((value) => !value)}>
          {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </button>
      </div>
    </div>
    {open && <nav id="mobile-site-menu" aria-label="Mobile navigation" className="mt-3 grid gap-1 rounded-[18px] border border-border bg-card p-2 lg:hidden">
      <Link to="/pricing" className={navLink} onClick={() => setOpen(false)}>Pricing</Link>
      <button type="button" className={navLink} onClick={() => section('about')}>About Own Masters</button>
      <button type="button" className={navLink} onClick={() => section('how-it-works')}>How it works</button>
      {!user && <Link to="/login" className={navLink} onClick={() => setOpen(false)}>Log in</Link>}
      <Link to={user ? '/dashboard' : '/signup'} className={`${action} mt-1`} onClick={() => setOpen(false)}>{user ? 'Open your workspace' : 'Create free account'}<ArrowRight className="size-4" aria-hidden="true" /></Link>
    </nav>}
  </header>;
}
