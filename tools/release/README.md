# Own Masters — production release

This folder is the deployable application. The website is already built. It
contains the Node server, bundled contract library, database migrations and email
letterhead. Tests, previews, development tools, private settings and user files
are excluded. File checksums are recorded in `RELEASE-MANIFEST.json`.

## Configure the host

Use Node 22.13+ (22 LTS or 24 LTS), PostgreSQL, LibreOffice Writer and persistent
file storage. The supplied Dockerfile includes Node and LibreOffice.

Copy `.env.example` to `.env` for a Node host, or `.env.production` for Compose.
Host-managed environment variables also work. Replace the example values with:

- Your public HTTPS domain in `APP_ORIGIN` and `CORS_ORIGIN`. Leave `VITE_API_BASE_URL` empty.
- Your production PostgreSQL connection in `DATABASE_URL`.
- A writable, persistent absolute path in `CONTRACT_STORAGE_ROOT`.
- Your SMTP server, authenticated sender and credentials. All account messages use the Own Masters letterhead.
- Your actual proxy addresses in `AUTH_TRUSTED_PROXY_IPS` if using forwarded client-IP headers.

The support address is `admin@teddbernard.com`. Initial access is free with
`BILLING_MODE=preview`, and `AI_FEATURES_ENABLED=false`. No payment account is
required for this mode. Back up PostgreSQL and persistent file storage together.

## Deploy with Docker Compose

Place the private `.env.production` beside `compose.production.yaml`, then run:

```sh
docker compose -f compose.production.yaml build
docker compose -f compose.production.yaml run --rm app npm run db:deploy
docker compose -f compose.production.yaml run --rm app npm run deploy:check -- --smtp
docker compose -f compose.production.yaml up -d
```

Compose listens at `127.0.0.1:8787` and keeps uploaded files in a named volume.
Put an HTTPS reverse proxy in front, preserve `/api` responses, allow 52 MB
uploads and a 120-second timeout. Use a separate PostgreSQL service reachable
from the container; `localhost` inside a container refers to that container.

## Deploy to a Node host

Install LibreOffice Writer and fonts on the host. Set the environment, then run:

```sh
npm ci --omit=dev
npm run db:deploy
npm run deploy:check -- --smtp
npm start
```

Installation generates the Prisma database client. No frontend build or test
dependencies are needed. Keep the service running with your host's service
manager. The server serves the website and `/api` together. Health checks use
`GET /api/health`. Production refuses incomplete settings.

## Check on the real domain

Create an account, receive and open confirmation email, sign in and reset its
password. Create a project, upload audio, save a contract, and download PDF/Word
copies. Check signed-PDF storage, mobile navigation and the Contact/Terms/Privacy
pages. Restart the service and confirm saved work remains available. Local
accounts and files are not transferred by this package.
