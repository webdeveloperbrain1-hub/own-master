# Connect the Vercel website to the application backend

## Diagnosis (November 10, 2026)

The Vercel project imports commit `796e15f` from
`webdeveloperbrain1-hub/own-master` with the **Vite** preset. It publishes the
built frontend but does not start `server/startProduction.mjs`.

Observed responses:

| Request | Result |
| --- | --- |
| `https://own-master-chi.vercel.app/` | 200 HTML |
| `https://own-master-chi.vercel.app/signup` | 404 Vercel NOT_FOUND |
| `https://own-master-chi.vercel.app/api/auth/config` | 404 Vercel NOT_FOUND |
| `https://own-master-chi.vercel.app/api/health` | 404 Vercel NOT_FOUND |
| `http://127.0.0.1:8787/api/auth/config` | 200 JSON |
| `http://127.0.0.1:8787/api/health` | 200 JSON, status ok |

The account page displays its service-unavailable message because its API request
gets a plain-text 404 instead of JSON. Direct links also need a React fallback.
The running local PostgreSQL container is a development service; starting or
rebuilding Docker Desktop does not connect it to Vercel.

## Prepared hosting option: Render

`render.yaml` describes a Docker web service, a separate production PostgreSQL
database and a 5 GB persistent disk. It uses the existing Dockerfile, which
includes LibreOffice for contract exports. The web service uses 2 GB RAM to leave
room for document conversion. Both compute resources are **paid**. Review current
[Render pricing](https://render.com/pricing) before creating them. This file
does not provision anything by itself. Automatic backend deploys are disabled.

1. Sign into Render and connect the GitHub repository. Use **New > Blueprint**
   after the reviewed deployment files are available in the repository. Review
   the generated resources and their charges before selecting Deploy.
2. Supply the sender's real SMTP host, port, from address, username and password
   in Render's secret settings. Use the provider's verified sender. Keep secrets
   out of Git, Vercel frontend variables and chat. The private local `.env` is
   not copied; these production settings are independent.
3. The Blueprint connects `DATABASE_URL` to the private production database and
   applies migrations with `npm run db:deploy` before starting the app. It does
   not copy local accounts or uploaded files.
4. Wait for the Docker service to become healthy. Its root storage directory
   must be writable by the image's `node` user. In the service's runtime shell,
   run `npm run deploy:check -- --smtp` to verify storage, conversion, database
   tables and SMTP connectivity without sending mail. Pre-deploy jobs cannot
   check the persistent disk because Render mounts it only in the running service.
5. Copy the actual HTTPS backend origin from Render. Test `/api/health` and
   `/api/auth/config` there; both must return 200 JSON. The backend intentionally
   uses `https://own-master-chi.vercel.app` for email links and mutation origins.

Render's persistent disk is attached to one instance. This configuration needs
brief downtime on redeploys. Keep database and file backups together. Leave
`AUTH_TRUSTED_PROXY_IPS` unset until the actual proxy socket addresses have been
verified; do not trust arbitrary forwarding headers.

## Connect Vercel

The new `vercel.mjs` supplies the Vite build settings and routing:

- `/api` and `/api/*` forward to the configured backend, preserving `/api`.
- Existing static files are served normally.
- Frontend routes such as `/signup`, `/auth/confirm` and `/dashboard` load React.
- API failures and missing assets do not turn into the frontend's HTML.

In **Vercel > own-master > Settings > Environment Variables**, add
`OWN_MASTERS_BACKEND_ORIGIN` to **Production**, using the actual backend origin
without a trailing slash. It is a routing setting, not a database or SMTP secret.
Do not point it at this Vercel website or at localhost. Keep
`VITE_API_BASE_URL` empty: browser requests must stay on the website's own origin
so the Secure, HttpOnly account cookie works.

The configuration refuses deployment when the backend origin is missing or
invalid, instead of publishing another frontend-only build. After setting it,
deploy the reviewed source to Vercel. These files have not been pushed or
deployed automatically. Preview deployments require their own backend/origin
configuration before testing account mutations.

Final checks on the Vercel domain:

1. Open `/signup` directly and refresh it. It must return 200 HTML.
2. `/api/health` and `/api/auth/config` must return 200 JSON. The latter must
   report `emailDeliveryAvailable: true`.
3. Use a mailbox you control to verify confirmation, login, refresh, logout and
   password recovery. SMTP connectivity alone does not prove inbox delivery.
4. Create a project and contract, export PDF/Word, upload audio, then restart
   the backend and verify that the records and files persist.

## References

- [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts)
- [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render persistent disks](https://render.com/docs/disks)

Vercel also supports container deployments now, but this application's current
Vite deployment does not run one. Running the container alone would still
require production PostgreSQL, SMTP and durable storage for uploaded/generated
files. The prepared Render option retains the current filesystem-based storage.
