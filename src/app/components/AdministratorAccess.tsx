import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';

export default function AdministratorAccess() {
  return <section className="rounded-[22px] border border-primary/40 bg-card p-5 sm:p-6" aria-label="Administrator access">
    <h2 className="flex items-center gap-2 text-[20px] font-bold"><ShieldCheck className="size-5 shrink-0" />Full administrator access</h2>
    <p className="mt-2 text-[14px] text-muted-foreground">Your library administrator account has full website access, including user management, library management, support reports, contract exports, and original downloads. No plan or subscription is required.</p>
    <Link to="/dashboard/admin" className="mt-4 inline-flex min-h-11 items-center rounded-[14px] border border-border px-4 py-2 text-sm font-semibold hover:bg-accent">Open website administration</Link>
  </section>;
}
