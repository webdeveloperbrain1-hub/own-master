# Own Masters

Deployment guide: [Initial deployment](initial-deployment.md). The application package and release archive are named **own-masters**; the checkout folder name does not affect the public site.

A music business workspace built with React, Vite, Tailwind, a Node API,
PostgreSQL/Prisma, and database-backed account authentication.

## Song projects

The dashboard's Track review workspace saves actual audio files and opens a
project page for each song.

Start a project with a title and either lyrics, a music file, or both. Audio is
optional for a lyrics-first project and can be added later from its project page.

Each project includes:

- Audio playback, download, and replacement (MP3, WAV, M4A, FLAC, OGG, WebM; 50 MB maximum).
- An editable song title and lyrics/reference notes.
- Persistent project notes.
- Attached existing contracts and a Create contract flow that attaches saved drafts automatically.
- Project deletion that removes audio and notes while keeping the original contracts.

Projects and filing drafts are scoped to the authenticated account. Audio is
stored privately under `CONTRACT_STORAGE_ROOT/project-audio` and served through
authenticated API requests. Metadata, notes, and contract links are stored in PostgreSQL.

Existing browser-only tracks are imported once when their owner opens the
dashboard. Their original browser copies are retained. Lyrics and notes carry
over; users must upload the audio again because the old workspace stored only
filenames. Historical development records keep their original owner; new drafts
always receive their owner from the authenticated session.

## Contract progress

Use Contract Filler to start a new contract. Saving opens a dedicated saved-contract
editor; existing contracts also open there from the dashboard, Contracts list,
or a song project. The editor keeps the document, saving, downloads, and progress
together without showing the template picker. Older Contract Filler draft links
redirect to the editor automatically. Discard changes restores the last saved
document rather than replacing it with a blank template.

Saved contracts have five manually controlled stages: Draft, Ready for review,
Awaiting signatures, Signed, and Cancelled. Open a saved draft or account contract
to change its stage and optionally record a note. The Contracts page can filter
by stage, and attached contracts show their stage inside song projects.

Upload a signed PDF (up to 20 MB) to mark a contract Signed. Copies are private,
downloadable, and kept separately from editable drafts; uploading another copy
retains the earlier files. Uploading records the owner's decision rather than
verifying signatures. Stage changes and uploads have a dated history. Existing
legacy completed records are not automatically relabeled Signed.

Progress records are stored in PostgreSQL, and PDFs live under
`CONTRACT_STORAGE_ROOT/signed-contracts`. Apply all Prisma migrations when
deploying and keep both the database and this storage directory persistent.
Deleting a contract also deletes its progress history and signed copies.

## Contract library

The Contract Filler includes its contract library in `server/assets/contract-library.zip`.
The API loads it automatically at startup, skipping existing contracts by content hash and preserving saved drafts.
No manual import or AI service is required. `CONTRACT_ZIP_PATH` can optionally override the bundled archive.

The picker organizes templates into consistent categories, shows original source
filenames and source-variant labels, and offers common contract types as starting
points. **Guides & Resources** is the default section. Selecting a guide opens a
separate read-only page that displays the original PDF with page and zoom
controls, plus an accessible text view. Downloading is an explicit action on
that page. Guide previews do not have editing or saving controls.
Processing labels distinguish extracted text from completed analysis; neither
label represents legal approval.

Duplicate hiding is a reversible catalog view. Every original file, database
record, template ID, and existing draft link is preserved. Candidates must have
matching complete extracted text without extraction warnings. Word candidates
are checked against the original source's body, headers, footers, footnotes,
endnotes, comments, and text boxes, preserving wording, punctuation, case, and
numbers. Unsupported or unverifiable sources stay visible unless byte-identical.
Formatting and file metadata are not treated as wording differences. Hidden
copies stay out of the picker; the library shows the available template count.
No files are deleted, renamed, or rewritten, and existing drafts continue using
their original template IDs.

The editor preserves source document layout and supports saved drafts and PDF/DOCX
exports. Word/RTF conversion requires LibreOffice; set `LIBREOFFICE_PATH` if it is
not installed in a standard location. Shared-library imports and scans require
an administrator (`app_metadata.role = admin`).

Contract editors warn before navigating away, using browser Back, logging out,
refreshing, or closing a tab with unsaved edits. In-app navigation offers
**Stay and edit** or **Discard and leave** and waits for an active save to finish.
Unsaved names, document text, and formatting also have an automatic recovery copy
in the current tab's session storage, separated by account and contract (or song
project for new drafts). Reopening the editor after a refresh offers to restore
that copy. Recovery does not save changes to the account; use **Save draft** or
**Save changes** to do that. Saving, reverting to the saved content, or explicitly
discarding clears the copy. Recovery depends on browser storage and is not a
backup across devices or after closing the tab.

## Pricing and billing

The public `/pricing` page and account plan screen show free early access.
`BILLING_MODE=preview` keeps payments disabled while current workspace features
and exports remain available. No demo plan, payment preview or card form is shown.
The server never creates a Stripe customer, subscription, Checkout session or
successful-payment record in this mode.

The server includes a Stripe Checkout/portal adapter, signed webhooks,
database-backed subscription status, and export access checks for future
activation. Pro initially covers PDF/DOCX exports and original contract template
downloads; project quotas, AI credits, team subscriptions, and one-off purchases
are not part of this release. See [Stripe setup and activation](stripe-billing.md).

Run `npx prisma migrate deploy` and `npx prisma generate` when updating, then
restart the API. Use `npm run test:integration` to verify early-access and subscription
behavior without a Stripe account or real payments.

## Responsive interface

The landing page uses a compact navigation menu below 1024 px. The workspace
uses a persistent left sidebar from 1024 px, with navigation, account controls,
theme switching, and View Pro together. On phones and tablets, a hamburger button
opens the same navigation in a slide-out drawer. The drawer closes on selection,
Escape, an outside click, or switching to the desktop layout, and keeps keyboard
focus inside while open. Project and library tabs reflow within the page. Mobile form fields use 16 px text, controls
have larger touch targets, and document actions form a compact two-column toolbar.
Dialogs scroll inside the visible viewport, including landscape layouts.
Wide contract pages remain inside their own pan/zoom viewer.

## Interface motion

The shared scroll controller reveals sections once as they enter view, including
cards loaded after navigation or within a scrolling library. Use `data-reveal`
on a section or `data-reveal-group` on a card grid to stagger its direct children.
`micro-interaction` adds subtle button feedback; `motion-card` adds a hover lift.
The controller respects reduced-motion preferences, reveals keyboard-focused
content immediately, and leaves document editors and PDF canvases stationary.
`data-reveal="none"` excludes an entire subtree. Content stays visible when the
observer API is unavailable and when printing. Run `npm run test:unit` for the
accessibility, lifecycle, and late-content checks.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `tools/development/env.example` to `.env` if needed and configure `DATABASE_URL`. No Supabase account or keys are required.
3. Start Docker Desktop, then run `docker compose -f tools/development/compose.yaml up -d postgres`.
4. Run `npx prisma migrate deploy` and `npx prisma generate`.
5. Run `npm run api` and `npm run dev` in separate terminals.
6. Open `http://127.0.0.1:5174`.

`npm run api` watches the server's imported files, so saving an email template or
other server code reloads the development API. A server started before this
watch-mode change needs one manual restart. Restart manually after changing
private `.env` settings. Production `npm start` uses the normal stable process.

All sign-ins require a real account. Demo login and authentication bypasses have been removed. Run the API
with `NODE_ENV=production` when deploying, and configure `CORS_ORIGIN` and
`VITE_API_BASE_URL` for the deployment. Keep PostgreSQL and `CONTRACT_STORAGE_ROOT`
on persistent storage. Access from another device requires the same reachable
API, database, and audio storage; a localhost address works only on this computer.

## Sign-up, login, and recovery

Accounts and legacy account contracts now use the same PostgreSQL database as song
projects and filing drafts. Supabase is no longer used at runtime. Existing local
projects and contracts are preserved. Historical development records are not
automatically assigned to new accounts. New accounts start with their own empty workspace. Unreachable remote
Supabase accounts or contracts are not automatically copied into this database.

Sign-up creates a pending account and sends a confirmation email. Email addresses
are normalized for uniqueness. Login and authenticated API access are blocked until
email ownership is confirmed. Existing accounts also need to confirm once; their
projects and contracts are retained. Passwords
are salted and hashed with scrypt (N=131072, r=8, p=1); plaintext passwords are not
stored. New passwords require at least 8 characters, including one lowercase letter,
uppercase letter, number, and special character (spaces do not count as special
characters), with a 256-character maximum. There are matching confirmation fields, password-manager support, and login/signup
rate limits stored in PostgreSQL.

Sessions use random 256-bit tokens in HttpOnly, SameSite=Lax cookies. Only token
hashes are stored in the database. Sessions expire after 30 days and are revoked
on logout or password reset. Production cookies require HTTPS. Requests use
credentials and a custom request header; mutation origins must match CORS_ORIGIN.
Authentication status refreshes across tabs and on focus. Successful login returns
to the requested dashboard path, query, and fragment.
Temporary account-service failures preserve an already open workspace and its
unsaved edits; only a confirmed expired session signs the user out. Login works
with cookies even when local browser storage is blocked. Signup gives the same
public result for new and existing addresses without changing existing credentials.

Confirmation and password recovery use standard SMTP with Nodemailer. Configure
APP_ORIGIN, SMTP_HOST, SMTP_PORT, SMTP_FROM, and optionally SMTP_USER / SMTP_PASSWORD
on the server. APP_ORIGIN is the trusted website address used in emailed links.
Without delivery settings, new sign-ups and email requests are disabled with a
clear message. Verified accounts can still log in. Signup delivery failures leave
the account pending and offer a resend rather than claiming an email was sent.

Reset links contain a random token in the URL fragment, expire in 30 minutes, and
can be used once. Only token hashes are stored. A password reset revokes existing
sessions and returns the user to login. SMTP requests give the same public reply
for known and unknown addresses; delivery failures are logged without addresses,
passwords, or reset tokens. Password recovery also confirms mailbox ownership and
invalidates outstanding confirmation links.

Email-confirmation links open /auth/confirm, carry a random 256-bit token in the
URL fragment, expire after one hour, and can be used once. The user must select
Confirm email; simply loading the page does not consume the link. Only token
hashes are stored in PostgreSQL. Resending has a server-enforced 60-second cooldown
and a three-request limit per address per 15 minutes. A fresh link replaces the
previous one. Unknown and verified addresses receive the same public resend reply.
Confirmation revokes existing sessions and requires password login afterward.

### Trying email locally

1. Start the local inbox with `docker compose -f tools/development/compose.yaml --profile email-preview up -d mailpit`.
2. In .env set EMAIL_DELIVERY_MODE=preview, APP_ORIGIN=http://127.0.0.1:5174,
   SMTP_HOST=127.0.0.1, SMTP_PORT=1025, and
   SMTP_FROM=Own Masters <no-reply@ownmasters.test>. Restart the API after changes.
3. Sign up, select Open local test inbox (http://127.0.0.1:8025), open the message,
   follow its link, select Confirm email, and log in with the chosen password.
4. For an existing pending account, use Resend confirmation email from login.

Mailpit captures these messages on this computer; it does not deliver them to
Gmail or other real inboxes. Its SMTP and web ports bind only to loopback. Preview
mode ignores real SMTP credentials and is rejected in production. Signup and
recovery pages label this mode explicitly. Captured emails may disappear when the
container is recreated; requesting a fresh link is safe. Preview settings are optional and for local development only.

For real email delivery set EMAIL_DELIVERY_MODE=smtp and configure a real sender.
Disable the preview Compose profile when deploying.
For real delivery to Gmail or other inboxes, follow [the email setup guide](account-email-setup.md) and
`tools/development/env.email.example`. Gmail recipients do not need to provide a Google API token.
`npm run mail:check` verifies SMTP without sending a message;
`npm run mail:check -- --to your-test-inbox@gmail.com` explicitly sends one test
message. Sender credentials belong only in the private server environment.

The initial login/signup forms do not show a resend-confirmation link. After
signup, **Didn’t receive the email?** reveals resend help; login offers recovery
only after the server confirms that the entered account still needs confirmation.

Use [the account deployment guide](auth-deployment.md) and
`.env.example` for production. `npm run build:production` creates the
same-origin frontend without embedding a development API URL.
`npm run auth:check -- --smtp` validates
production settings, account database tables, and the SMTP connection without
sending email. `npm start` forces production mode and rejects incomplete account
configuration. The final launch check still requires confirmation and reset emails
delivered to a real inbox on the public HTTPS domain.

For deployment, set NODE_ENV=production, use HTTPS and persistent PostgreSQL / file
storage, and serve /api through a reverse proxy on the website's origin. Leave
VITE_API_BASE_URL empty for this arrangement; Vite proxies /api locally. Alternatively
use an HTTPS API on the same site with the website's exact CORS_ORIGIN and browser
credentials enabled (this needs a separate deployment review; the production
configuration check supports the same-origin arrangement). Cross-site cookie hosting is not configured. Configure the
website to serve index.html for client routes including /reset-password and /auth/confirm. Do not
expose the development server publicly. Real SMTP delivery needs a configured sender;
the integration tests use only a local in-process SMTP server.

References: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[Nodemailer SMTP](https://nodemailer.com/smtp), and
[Mailpit local inbox](https://mailpit.axllent.org/docs/install/docker/).

## Validation

- `npm run build` — builds the same-origin production website.
- `npm run typecheck` — checks frontend types.
- `npm run test:unit` — browser flows, document rendering, email letterhead, routing, catalog and recovery checks.
- `npm run test:integration` — accounts, SMTP fixtures, projects, billing and contract progress against local PostgreSQL. Fixtures are isolated and cleaned up.
- `npm run deploy:check -- --smtp` — checks production settings, database, writable storage, conversion and SMTP without sending email.
- `npm run release:package` — creates the built own-masters production folder and ZIP.

Collaboration invitations, ownership splits, electronic signing, and audio version history
are future features. Project notes are currently private to the owner.
