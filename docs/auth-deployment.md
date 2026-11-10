# Deploying account access

For the complete initial release and container setup, start with
[initial-deployment.md](initial-deployment.md).

The supported deployment serves the built website and `/api` on the same public
HTTPS origin. This keeps the HttpOnly, Secure, SameSite=Lax session cookie working
without third-party cookies. Use a Node host, PostgreSQL, persistent file storage,
and an SMTP provider with a verified sending domain.

## Configuration

Use `.env.example` as the settings reference. Put secrets in the host's
environment/secret manager. Do not put database or SMTP credentials in `VITE_`
variables or commit a populated environment file.

- `APP_ORIGIN` and `CORS_ORIGIN` must be the exact public HTTPS origin, with no
  path or trailing slash. Email links always use `APP_ORIGIN`.
- Build with an empty `VITE_API_BASE_URL`. Forward `/api/*` to the Node service;
  never rewrite API errors to the SPA's HTML.
- Configure real `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and the provider's matching
  `SMTP_USER` / `SMTP_PASSWORD`. Port 465 uses TLS; other remote ports require
  STARTTLS. Follow the provider's sender verification and SPF/DKIM instructions.
  A trusted local SMTP relay can omit credentials. Preview/Mailpit is for local
  development and cannot run as production email delivery.
- Replace development database credentials and keep PostgreSQL private. Back up
  both the database and `CONTRACT_STORAGE_ROOT`.
- `API_HOST` defaults to `0.0.0.0` in production and loopback in development. A host
  may supply `PORT`. Route traffic through the HTTPS proxy in that setup.
- For accurate rate limiting behind a reverse proxy, list only its actual socket
  IP addresses in `AUTH_TRUSTED_PROXY_IPS`. Forwarded headers from all other peers
  are ignored. Follow the forwarding chain from the trusted proxy to the first
  untrusted address; visitors cannot choose arbitrary rate-limit identities.
  Leave this empty for direct connections. A same-machine nginx proxy can use
  `127.0.0.1,::1`. Do not copy those IPs for an unrelated hosting platform.

## Release checks

```sh
npm ci
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm run build:production
npm audit
npm run auth:check -- --smtp
npm start
```

Run `auth:check` with the production environment configured. It validates account
settings, database access, and required account tables; `--smtp` additionally
checks SMTP connectivity/authentication without sending mail. This does not prove
inbox delivery. `npm start` forces production mode and refuses incomplete account
configuration, including local/HTTP origins and preview email delivery. The
application has no demo account or authentication bypass in any mode.
`build:production` explicitly uses relative `/api` requests, preventing a local
API URL in a developer's `.env` from being embedded in the deployed website.

`npm start` serves `dist/` and `/api` together. Alternatively, serve `dist/` through the HTTPS host, with `index.html` fallback for frontend
routes such as `/login`, `/signup`, `/auth/confirm`, and `/reset-password`.
Configure the host to send `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY` for the website. Enable
HSTS after confirming HTTPS for the final domain. The Node API sends no-store
and nosniff response headers itself.

For a same-machine nginx deployment, the relevant routing looks like:

```nginx
# Inside the existing TLS server block for the real domain:
root /var/www/ownmasters/dist;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy no-referrer always;
add_header X-Frame-Options DENY always;
location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Support the app's audio and signed-document uploads.
    client_max_body_size 52m;
    proxy_read_timeout 120s;
}
location / { try_files $uri $uri/ /index.html; }
```

Do not expose `npm run dev`, Adminer, Mailpit, or the database to the public web.
The development Docker Compose file is a local setup, not a production deployment.

## Verify on the real domain

Use a test mailbox you control. Create an account, receive the confirmation email,
confirm it, and log in. Check a protected page after refresh and in a second tab.
Log out and confirm protected API requests are rejected. Request a password reset,
receive the email, and change the password. The previous password, old sessions,
expired links, and reused links must fail. Verify that confirmation and reset links
open directly from email, including on mobile. Check spam placement and sender
authentication in the actual inbox.

The automated account suite uses isolated database records and a local SMTP
fixture, so it sends no real emails. It covers these flows, throttling, production
cookies, and isolation between owners. New or reset passwords require 8–256
characters (minimum counted as Unicode code points), with at least one lowercase
letter, uppercase letter, number, and punctuation/symbol character. Spaces do not
count as special characters. Existing passwords still work for login. Password
managers are supported.

The npm lockfile includes security updates for routing, ZIP/XML processing and
build dependencies. A scoped `@prisma/config` override pins `deepmerge-ts` 8.0.0
for its circular-reference fix, while retaining Prisma 6 and the existing schema.
This repository does not use custom Map-based Prisma configuration. Prisma client
generation, migration status, and the account/database tests are checked with this
override. Revisit it when upgrading Prisma; do not run a forced major ORM upgrade
as part of a routine release. Re-run `npm audit` for each release because advisory
information changes over time.

Reference: [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
and [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
