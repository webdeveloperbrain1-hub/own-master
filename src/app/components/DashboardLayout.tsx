import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { CreditCard, FolderOpen, LayoutDashboard, LogOut, Menu, PenLine, Sparkles, UserRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { authErrorMessage } from '../auth/authFlows';
import { useBilling } from '../billing/BillingContext';
import ThemeToggle from './ThemeToggle';
import { useLeaveConfirmation } from './UnsavedChanges';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from './ui/sheet';

const navItems = [
  ['/dashboard', 'Dashboard', LayoutDashboard],
  ['/dashboard/contracts', 'Contracts', FolderOpen],
  ['/dashboard/contract-filler', 'Contract Filler', PenLine],
  ['/dashboard/billing', 'Billing', CreditCard],
  ['/dashboard/account', 'Account', UserRound],
] as const;

const menuButton = 'micro-interaction inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] border border-border bg-muted px-3 py-2.5 text-[13px] font-bold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export default function DashboardLayout() {
  const { catalog, status: billingStatus, showUpgrade, isAdmin } = useBilling();
  const requestLeave = useLeaveConfirmation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const name = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Your account';

  useEffect(() => { setMenuOpen(false); }, [location.key, user?.id]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError('');
    try {
      await signOut();
      navigate('/', { replace: true });
    } catch (error) {
      setLogoutError(authErrorMessage(error));
    } finally {
      setLoggingOut(false);
    }
  }

  function closeMenu() { setMenuOpen(false); }

  function workspaceMenu() {
    return <>
      <Link to="/dashboard" onClick={closeMenu} className="flex min-h-[76px] shrink-0 items-center gap-2.5 border-b border-border px-5 pr-14 text-[17px] font-[850] tracking-[-0.3px] lg:pr-5">
        <img src="/own-masters-logo.png" alt="" className="h-auto w-10 shrink-0 brightness-0 dark:brightness-100" />
        Own Masters
      </Link>

      <div className="flex-1 px-4 py-6">
        <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
        <nav aria-label="Workspace navigation" className="grid gap-2">
          {navItems.filter(([href]) => !(isAdmin && href === '/dashboard/billing')).map(([href, label, Icon]) => {
            const isActive = location.pathname === href ||
              (href === '/dashboard' ? location.pathname.startsWith('/dashboard/projects/') : location.pathname.startsWith(`${href}/`));
            return <Link key={href} to={href} onClick={closeMenu} aria-current={isActive ? 'page' : undefined}
              className={`micro-interaction flex min-h-12 items-center gap-3 rounded-[14px] border px-3.5 py-3 text-[14px] font-[750] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
              <Icon className="size-[18px] shrink-0" aria-hidden="true" />
              {href === '/dashboard/billing' && catalog?.mode === 'preview' ? 'Your plan' : label}
            </Link>;
          })}
        </nav>
      </div>

      <div className="mt-auto shrink-0 space-y-4 border-t border-border p-4">
        {!isAdmin && catalog?.mode === 'stripe' && billingStatus?.plan !== 'pro' && <button type="button" onClick={() => { closeMenu(); showUpgrade(); }} className={`${menuButton} w-full`}>
          <Sparkles className="size-4 shrink-0" aria-hidden="true" />View Pro
        </button>}
        <div className="flex min-w-0 items-center gap-3 px-1">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-accent text-[14px] font-bold">{name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-[750]" title={name}>{name}</p>
            <p className="text-[12px] text-muted-foreground">{isAdmin ? 'Administrator' : 'Your workspace'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button type="button" onClick={() => { closeMenu(); requestLeave(handleLogout); }} className={`${menuButton} min-w-0 flex-1`} disabled={loggingOut}>
            <LogOut className="size-4 shrink-0" aria-hidden="true" />{loggingOut ? 'Logging out…' : 'Logout'}
          </button>
        </div>
      </div>
    </>;
  }

  return <div className="min-h-screen lg:pl-64 print:!pl-0">
    <a href="#workspace-content" className="sr-only z-[60] rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
    <aside aria-label="Workspace sidebar" data-reveal="none" className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto border-r border-border bg-background lg:flex print:!hidden">
      {workspaceMenu()}
    </aside>

    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      <header data-reveal="none" className="sticky top-0 z-30 flex min-h-[76px] items-center gap-3 border-b border-border bg-background px-4 sm:px-6 lg:hidden print:!hidden">
        <SheetTrigger asChild>
          <button type="button" aria-label="Open workspace menu" className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] border border-border bg-muted hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </SheetTrigger>
        <Link to="/dashboard" className="flex min-w-0 items-center gap-2 text-[16px] font-[850] tracking-[-0.3px]">
          <img src="/own-masters-logo.png" alt="" className="h-auto w-9 shrink-0 brightness-0 dark:brightness-100" />
          Own Masters
        </Link>
      </header>
      <SheetContent side="left" data-reveal="none" className="h-dvh w-[min(20rem,calc(100vw-2rem))] gap-0 overflow-y-auto sm:max-w-none [&>button]:size-11 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:top-4 [&>button]:right-3 motion-reduce:animate-none motion-reduce:transition-none">
        <SheetTitle className="sr-only">Workspace menu</SheetTitle>
        <SheetDescription className="sr-only">Navigate your workspace and manage your account.</SheetDescription>
        {workspaceMenu()}
      </SheetContent>
    </Sheet>

    <div id="workspace-content" tabIndex={-1} className="mx-auto max-w-[1180px] px-4 pb-10 pt-6 outline-none sm:px-6 sm:pb-14 lg:pt-8 xl:px-8">
      {logoutError && <p role="alert" className="mb-4 text-[14px] text-red-700 dark:text-red-200">{logoutError}</p>}
      <Outlet />
    </div>
  </div>;
}
