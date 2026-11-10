# Own Masters

A music business workspace for projects, private audio, contract editing,
PDF/Word exports and signed-document storage.

## Initial deployment

Run `npm run release:package` to type-check and build the website, then create:

- `releases/own-masters/` — a production application ready to configure on your host.
- `releases/own-masters.zip` — the same folder as a portable archive.

The release contains the built website, server, contract library, branded email
templates, migrations and production commands. Tests, previews, development
tools, private environment files and user data stay out of the release.

Use the release's README for the installation steps. A domain/HTTPS host,
production PostgreSQL, persistent file storage and SMTP settings are still
required. `.env.example` is the production configuration reference. See
[initial deployment](docs/initial-deployment.md) for host setup and launch checks.

Initial access is free (`BILLING_MODE=preview`). AI is disabled by default.
The support email is `admin@teddbernard.com`.

## Project structure

```text
src/             Website source
public/          Public assets and account-email logo
server/          Application server, libraries and bundled contracts
prisma/          Database schema and migrations
scripts/         Production build and deployment checks
docs/            Deployment and development documentation
tests/           Source verification; excluded from deployment
tools/           Local email previews, maintenance and release packaging
releases/        Generated production folder and ZIP; ignored by Git
storage/         Private local user files; excluded from deployment
```

The checkout can remain named `own-master-local`; the generated deployment folder
and package are named `own-masters`.

## Local development

Use Node 22.13+ (22 LTS or 24 LTS) and npm. Keep your existing private `.env`.
For a new checkout, copy `tools/development/env.example` to `.env`.

```sh
npm ci
docker compose -f tools/development/compose.yaml up -d postgres
npm run db:deploy
npx prisma generate
npm run api
```

Run `npm run dev` in a second terminal. Use `npm run typecheck`,
`npm run test:unit` and `npm run test:integration` to verify changes. Integration
checks require the local database and migrations. `npm run mail:preview` opens
local email designs; `npm run mail:check` checks configured SMTP without sending
unless you explicitly pass a recipient.

Feature and developer notes are in [development.md](docs/development.md).
