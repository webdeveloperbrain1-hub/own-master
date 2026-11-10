# Own Masters: initial deployment

The initial release is a free account workspace: projects, private audio,
contract editing/saving, PDF/Word exports, guides and signed-PDF storage. There is
no demo login, simulated invitation delivery, or electronic-signature service.
AI is off by default. Payments stay disabled with `BILLING_MODE=preview`; the
website presents free early access rather than a checkout preview.

## Name and source

The application package and deployment archive are named `own-masters`. The
original checkout or GitHub repository may still be named `own-master-local`;
that directory/repository name is not part of the public website. The release
archive extracts into `own-masters/` and can be deployed from any directory.

`npm run release:package` type-checks and builds the website, then creates both
`releases/own-masters/` and `releases/own-masters.zip` from an explicit allowlist.
They contain the built website, server, server-only dependency lock, migrations,
email letterhead and bundled library. Tests, source development tools, private
`.env` files, uploads, databases, logs and Git metadata are excluded. Previous
handoffs are retained under `releases/archive/`. The release README describes
installation; `RELEASE-MANIFEST.json` records each file's checksum. Commit the
reviewed source separately before a Git-based deployment. This package does not
transfer local user accounts or uploaded files.

The included GitHub Actions workflow checks builds and tests against a separate
PostgreSQL service after a push or pull request. It does not publish the website
or connect to a production database. `npm run test:unit` can run without a local
database; `npm run test:integration` requires PostgreSQL and applied migrations.

## Settings and services to supply

Use `.env.example` as a reference. Configure actual values in the
host's secret manager. For Docker Compose only, copy it to a private
`.env.production` file; that file is ignored by Git and the release packager.

- `APP_ORIGIN` and `CORS_ORIGIN`: the same final public HTTPS origin, without a
  path or trailing slash. Leave `VITE_API_BASE_URL` empty.
- `BUSINESS_NAME`: the operator name shown on Terms, Privacy and Contact pages.
  The current public name is Own Masters.
- `SUPPORT_EMAIL`: currently `admin@teddbernard.com`, as selected by the owner.
  Read the public pages and confirm their descriptions match the intended
  operation before launch.
- `DATABASE_URL`: private production PostgreSQL with its own credentials. Never
  use the development password. Provision/restore the intended database; the
  release does not copy local accounts or files to it.
- `CONTRACT_STORAGE_ROOT`: persistent, writable storage. Back up the database and
  the whole storage root together. The Docker image uses
  `/var/lib/ownmasters/storage`. Leave the optional per-directory overrides unset
  so all generated documents remain under that root.
- SMTP: real sender settings for confirmation and password-recovery email.
  Verify the sending address/domain with the provider, including SPF/DKIM.
  The support address does not automatically change the authenticated sender.
- `AUTH_TRUSTED_PROXY_IPS`: only the actual proxy socket IP addresses seen by the
  Node process. Do not guess these or copy loopback addresses for a container
  gateway. Empty means forwarded client-IP headers are ignored.
- Keep `AI_FEATURES_ENABLED=false` and `BILLING_MODE=preview` for the initial
  template-based release. AI settings and Stripe activation are separate work.

## Option A: the supplied container

The image includes Node, the built website, Prisma and LibreOffice for document
conversion. It runs as a non-root user and listens on port 8787 (or the host's
`PORT`). It does not include PostgreSQL or user data. A Docker-capable host can
use the Dockerfile with a managed PostgreSQL database and a persistent volume
at `/var/lib/ownmasters/storage`.

For a Linux host using Compose and a private `.env.production`:

```sh
docker compose -f compose.production.yaml build
docker compose -f compose.production.yaml run --rm app npm run db:deploy
docker compose -f compose.production.yaml run --rm app npm run deploy:check -- --smtp
docker compose -f compose.production.yaml up -d
```

Compose exposes the app only at `127.0.0.1:8787`. Put the final HTTPS reverse
proxy in front of it. Forward the entire website to the app, preserve `/api`
responses, allow uploads of at least 52 MB and a 120-second request timeout, and
configure the trusted forwarding headers. The host provides the TLS certificate.
Hosted container platforms can provide their own HTTPS endpoint and health check.

## Option B: a Node host

Use Node 22.13+ (22 LTS or 24 LTS) and install LibreOffice Writer plus fonts.
From the generated `releases/own-masters/` folder, set the production environment
above (or copy `.env.example` to a private `.env`), then:

```sh
npm ci --omit=dev
npm run db:deploy
npm run deploy:check -- --smtp
npm start
```

The release already contains the built frontend, and installation generates the
Prisma client. For a deployment directly from this source checkout, run `npm ci`,
`npx prisma generate`, `npm run typecheck` and `npm run build` before deploying.

`npm start` serves both `dist/` and `/api` from the same Node service. It refuses
incomplete production settings, missing frontend builds or an unavailable
database/library. Frontend deep links receive `index.html`; missing `/api` routes
and static assets stay errors. Only `dist/` is public; `.env`, server source and
private storage are not served. The app supports graceful termination and
`GET /api/health` returns 200 only while PostgreSQL responds.

Keep the process running using the host's service manager. Enable HTTPS at the
host/proxy. Never expose the Vite development server, Adminer, Mailpit or
PostgreSQL directly to the public internet.

## Final checks on the real domain

1. Create two accounts using mailboxes you control. Receive confirmation email,
   confirm, log in, refresh, log out, and reset the password. Open emailed links
   on a phone. Check inbox/spam placement. SMTP connection checks send no mail.
2. Create a project, upload audio, save notes, create and edit a contract, reopen
   it and download PDF/Word copies. Check actual document layout in both formats.
3. Change contract progress and upload/download a signed PDF. The UI explains
   that this stores a copy; it does not verify or collect signatures.
4. Confirm the second account cannot access the first account's documents/audio.
   Check direct API requests as well as the interface.
5. Restart the service and verify all saved files and records remain accessible.
   Restore a backup into a separate environment before accepting valuable data.
6. Open Terms, Privacy and Contact and check operator/contact details. Test mobile
   navigation, the editor and account recovery. Confirm no demo or fake Send
   controls are visible.
7. Configure uptime/error monitoring and name the person handling support.

Payment activation, pricing and existing-user access decisions are documented in
`stripe-billing.md`. Do not switch Stripe mode just to remove an early-access
label; preview is the intentional no-payment operating mode.
