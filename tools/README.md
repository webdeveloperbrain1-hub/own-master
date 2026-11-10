# Local tools

These files support development and maintenance. They are excluded from the
deployable release and production image.

- `development/`: local PostgreSQL/Adminer/Mailpit Compose services and example local settings.
- `email/`: account-mail previews and SMTP diagnostics.
- `maintenance/`: manual contract imports, scans, reports and recovery utilities.
- `legacy/`: previous Supabase schema, design guidelines and unused generated project files retained for reference.
- `release/`: generates the production folder and ZIP from an explicit file allowlist.
- `runTests.mjs`: runs verification from the separate `tests/` folder.

Run tools from the project root. Maintenance scripts named `reset*` change
database records; they are never run by startup, deployment or release packaging.
