# Free cloud trial

This option runs in the cloud while the developer's PC is off. It preserves
real signup/confirmation, login, projects, audio, contract editing/exports and
signed PDF storage. It uses the existing application authentication and email
design. AI and payments keep their existing disabled/preview settings.

| Part | Free trial service |
| --- | --- |
| Website | Existing Vercel project |
| Docker API and LibreOffice | Existing Render Free service `own-master` in Ohio |
| PostgreSQL | A free Supabase project |
| Audio, signed PDFs and generated documents | A private Supabase Storage bucket |
| Confirmation/password recovery | A free Brevo sender using SMTP port 2525 and STARTTLS |

Render Free sleeps after inactivity and can be slow on the first visit. Supabase
Free has 500 MB database storage, 1 GB file storage, and a 50 MB per-file limit;
inactive projects can pause. Brevo requires sender/account activation and has
free sending quotas. Check the provider dashboards before accepting uploads.
This is a limited trial, with no uptime promise or automatic paid upgrades.

## Supabase

Sign into your own Supabase account. Use a dedicated **Free** project for this
trial so its application tables do not conflict with another app. Choose a
region near the Render service when available.

1. Record the project URL and database password privately.
2. In the project's connection dialog, select the **session pooler** connection
   on port 5432 for IPv4 compatibility. Use the complete PostgreSQL URI as
   `DATABASE_URL`. URL-encode special characters in its password. For this
   single-instance trial, append `?connection_limit=3` (or add it with `&` if
   there are already query parameters). Do not use the browser anon key as a
   database password.
3. In Storage, create `own-masters-private` with **Public bucket disabled**.
4. In the project's API settings, locate its server secret or legacy service-role
   key. Store it only in Render as `SUPABASE_STORAGE_KEY`, with the project URL
   in `SUPABASE_URL`. Never use a `VITE_` prefix or paste a secret into chat/Git.

The app checks that the bucket is private. Uploaded files are stored there
before the database records an upload. Downloads retain the existing ownership
checks and restore the local cache when needed. Bundled library originals are
rebuilt from the shipped archive after a Render restart, preserving draft IDs.

## Brevo

Create a **Free** account, complete its verification/transactional activation,
and verify the sender you want to use. In Brevo's SMTP settings, use its **SMTP
login and SMTP key**, which differ from your account password or an API key.

Enter these settings privately in Render:

```dotenv
EMAIL_DELIVERY_MODE=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_FROM=Own Masters <your-verified-sender-address>
SMTP_USER=your-Brevo-SMTP-login
SMTP_PASSWORD=your-Brevo-SMTP-key
```

The existing Nodemailer transport requires STARTTLS on remote port 2525. Render
Free blocks outbound SMTP on 25, 465 and 587; the provider must support the port
selected here. Gmail's existing SMTP settings cannot simply be changed to 2525.

## Configure the existing Render service

`render.free.yaml` records the free settings. The original `render.yaml` remains
the separate paid deployment option; do not deploy it for this trial.

For the existing manually created service, add the Supabase and Brevo settings
under Environment, and set:

```dotenv
FILE_STORAGE_BACKEND=supabase
SUPABASE_STORAGE_BUCKET=own-masters-private
CONTRACT_STORAGE_ROOT=/var/lib/ownmasters/storage
APP_ORIGIN=https://own-master-chi.vercel.app
CORS_ORIGIN=https://own-master-chi.vercel.app
VITE_API_BASE_URL=
```

Keep the already saved business/support settings. Set **Docker Command** to
`node server/startTrial.mjs`, keep the service on **Free**, and use
`/api/health` as its health check. Do not add a paid disk or paid Render database.
The trial startup command applies Prisma migrations before starting the normal
production server because Free has no pre-deploy command. The Docker image must
contain the reviewed trial changes before deploying this command.

In Vercel Production, set
`OWN_MASTERS_BACKEND_ORIGIN=https://own-master.onrender.com`, keep
`VITE_API_BASE_URL` empty, and deploy the routing configuration. Preview domains
need their own origin configuration to test account mutations.

## Verify on the real services

1. Render `/api/health` and `/api/auth/config` must return 200 JSON.
2. Open Vercel `/signup` directly and refresh it.
3. Use a test mailbox you control to check actual confirmation and recovery
   delivery, login, refresh and logout.
4. Create a song, upload audio, save/edit/export a contract, and store a signed
   PDF. Restart the API; confirm that all records and uploaded files remain.
5. Check that another account cannot download the first account's files.

Local checks cannot prove that cloud credentials, sender activation or the live
bucket work. No cloud credentials or existing user files are included in Git.

Sources: [Render Free](https://render.com/docs/free),
[Supabase quotas](https://supabase.com/pricing),
[Supabase connection modes](https://supabase.com/kb/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO),
[Brevo SMTP](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).
