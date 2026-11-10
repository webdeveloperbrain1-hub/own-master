import { Link } from 'react-router';
import { ArrowLeft, Mail } from 'lucide-react';
import SiteFooter from '../components/SiteFooter';
import { useSiteConfiguration } from '../data/siteConfiguration';

const block = 'space-y-3 rounded-[20px] border border-border bg-card p-5 sm:p-7';
const paragraph = 'text-[15px] leading-relaxed text-muted-foreground';

export default function InformationPage({ page }: { page: 'terms' | 'privacy' | 'contact' }) {
  const { businessName, supportEmail, aiEnabled } = useSiteConfiguration();
  const support = supportEmail ? <a href={`mailto:${supportEmail}`} className="break-all font-semibold text-foreground underline underline-offset-4">{supportEmail}</a> : <span role="status">Support contact details could not be loaded. Please try again shortly.</span>;
  const title = { terms: 'Terms of use', privacy: 'Privacy', contact: 'Contact & help' }[page];
  return <main className="mx-auto max-w-[860px] px-4 pb-10 sm:px-6 sm:pb-16">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-5">
      <Link to="/" className="flex min-h-11 items-center gap-2 text-lg font-extrabold"><img src="/own-masters-logo.png" alt="" className="w-10 brightness-0 dark:brightness-100" />Own Masters</Link>
      <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to home</Link>
    </header>
    <div className="pb-7 pt-10 sm:pt-14"><p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Own Masters</p><h1 className="text-[36px] font-bold leading-tight sm:text-[46px]">{title}</h1><p className={`${paragraph} mt-4`}>Operated by {businessName}.</p></div>
    {page === 'terms' && <div className="grid gap-5">
      <section className={block}><h2 className="text-xl font-bold">Using your workspace</h2><p className={paragraph}>Own Masters helps you prepare and store music contract drafts, organize song projects, and track documents. Keep your account details secure and use the service only for materials you are entitled to upload and manage.</p></section>
      <section className={block}><h2 className="text-xl font-bold">Review documents before relying on them</h2><p className={paragraph}>Templates are starting points. You are responsible for checking names, amounts, ownership, dates, missing fields and the suitability of the wording for your situation. Own Masters does not provide a lawyer-client relationship or a guarantee that a document is suitable or enforceable. Obtain qualified advice when needed.</p>{aiEnabled && <p className={paragraph}>AI assistance can make mistakes or miss important details. Review its output and the complete document before using it.</p>}</section>
      <section className={block}><h2 className="text-xl font-bold">Your music and documents</h2><p className={paragraph}>Uploading a file does not transfer ownership of your music or documents to Own Masters. The service stores and processes your content to provide the workspace functions you use. Do not upload content that infringes another person’s rights or use the service to access another account’s information.</p></section>
      <section className={block}><h2 className="text-xl font-bold">Signing and sharing</h2><p className={paragraph}>Download documents to arrange review and signing outside Own Masters. Uploading a signed PDF records your decision to mark it Signed; Own Masters does not verify signatures or collect electronic signatures.</p></section>
      <section className={block}><h2 className="text-xl font-bold">Access and keeping your copies</h2><p className={paragraph}>During free early access, no payment or card details are required. Any future paid offer will explain its price and features before you choose a subscription. Keep your own downloaded copies of important documents. Contact support about access problems or account removal.</p><p className={paragraph}>{support}</p></section>
    </div>}
    {page === 'privacy' && <div className="grid gap-5">
      <section className={block}><h2 className="text-xl font-bold">Information in the service</h2><p className={paragraph}>Own Masters stores the name and email you provide, a password hash, account verification and session records, and the projects, lyrics, notes, contracts, audio and signed PDFs you save. Passwords are hashed rather than stored as readable text.</p></section>
      <section className={block}><h2 className="text-xl font-bold">How information is used</h2><p className={paragraph}>Account information enables login, confirmation emails and password recovery. Your saved content enables project organization, contract editing and downloads. Rate-limit records and operational error logs help protect and operate the service. The hosting, database, file-storage and email services process information needed for those functions.</p>{aiEnabled && <p className={paragraph}>When you use AI assistance, the contract content needed for that request is sent to the configured AI service to produce the response. Avoid including information that is unnecessary for the request.</p>}</section>
      <section className={block}><h2 className="text-xl font-bold">Cookies and browser storage</h2><p className={paragraph}>A session cookie keeps you signed in. Browser storage can remember interface preferences and keep a temporary recovery copy of unsaved edits. Recovery copies are specific to that browser or tab and are not a replacement for saving your work.</p></section>
      <section className={block}><h2 className="text-xl font-bold">Your files and requests</h2><p className={paragraph}>Private project and contract requests require an authenticated account and check ownership. You can edit or delete projects and contracts using the workspace and download available copies. For questions about retained information, corrections, or account and data deletion, contact {businessName}. Do not include your password or confirmation/reset links in your message.</p><p className={paragraph}>{support}</p></section>
    </div>}
    {page === 'contact' && <div className="grid gap-5">
      <section className={block}><Mail className="size-7 text-primary" aria-hidden="true" /><h2 className="text-xl font-bold">Get help with Own Masters</h2><p className={paragraph}>For account access, document problems, feedback or data requests, contact {businessName}.</p><p className={paragraph}>{support}</p><p className={paragraph}>Describe what you were trying to do and any error message. Do not send passwords, payment details, or email confirmation/reset links.</p></section>
      <section className={block}><h2 className="text-xl font-bold">Can’t log in?</h2><p className={paragraph}>Check your inbox and spam folder for the confirmation email. If you need a new link or password, use the account recovery pages.</p><div className="flex flex-wrap gap-4 text-sm font-semibold"><Link className="inline-flex min-h-11 items-center underline underline-offset-4" to="/resend-confirmation">Resend confirmation</Link><Link className="inline-flex min-h-11 items-center underline underline-offset-4" to="/forgot-password">Reset password</Link></div></section>
    </div>}
    <SiteFooter />
  </main>;
}
