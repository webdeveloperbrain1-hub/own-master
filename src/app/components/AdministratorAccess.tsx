import { ShieldCheck } from 'lucide-react';

export default function AdministratorAccess() {
  return <section className="rounded-[22px] border border-primary/40 bg-card p-5 sm:p-6" aria-label="Administrator access">
    <h2 className="flex items-center gap-2 text-[20px] font-bold"><ShieldCheck className="size-5 shrink-0" />Full administrator access</h2>
    <p className="mt-2 text-[14px] text-muted-foreground">All workspace features, contract exports, original downloads, and library uploads are included. No plan or subscription is required.</p>
  </section>;
}
