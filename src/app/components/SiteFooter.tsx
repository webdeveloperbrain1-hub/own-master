import { Link } from 'react-router';

export default function SiteFooter() {
  return <footer className="mt-9 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-7 text-[13px] text-muted-foreground">
    <p>Own Masters. Be the label. Own the masters.</p>
    <nav aria-label="Information" className="flex flex-wrap gap-5">
      {[['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/contact', 'Contact']].map(([href, label]) => <Link key={href} to={href} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline">{label}</Link>)}
    </nav>
  </footer>;
}
