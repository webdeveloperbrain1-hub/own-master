# Own Masters production launch checklist

Things to change or confirm before moving from the test deployment to the public website. This checklist is based on the current project files; the live services still need to be checked. Unticked items are pending confirmation, rather than confirmed problems.

- [ ] **Confirm the official support email.** Replace any developer or test contact address with the agreed Own Masters address. The project defaults currently use `admin@teddbernard.com`; confirm whether to keep it. Check Contact, Terms, Privacy and the support details in account emails.
- [ ] **Set the official email sender.** Use the approved Own Masters address for confirmation and password-reset emails, verify it with the email provider, and make sure replies reach the support inbox. The sending address and support address are separate settings.
- [ ] **Connect the final website domain.** Replace the test website address wherever necessary. The deployment files currently reference `own-master-chi.vercel.app`. Check that account emails open the final HTTPS website.
- [ ] **Confirm the public business details.** Check the Own Masters name, logo, contact details and the operator name on Terms and Privacy. Review those pages against how the launched service will actually work.
- [ ] **Confirm service ownership and costs.** Give the intended owner access to the domain, hosting, database, file storage and email provider. Agree who manages billing, renewals and support.
- [ ] **Choose the hosting setup for launch.** Confirm whether the current trial setup meets the launch requirements or needs upgrading. Make sure the website and backend run independently of the developer's computer.
- [ ] **Connect the website to the production backend.** Confirm that signup, login and the workspace reach the correct service, and that opening or refreshing a page directly works.
- [ ] **Use the intended production database and private file storage.** Apply the required database updates and make sure audio, contracts and signed PDFs have durable storage. Packaging or deploying the application does not automatically transfer existing accounts or files.
- [ ] **Agree what happens to test data.** Decide which trial accounts, projects and uploads, if any, should be carried over. Keep unwanted test data out of the production setup and preserve anything the owner wants to retain.
- [ ] **Set production credentials privately.** Configure the production database, storage and email credentials in the hosting service. Replace development credentials and confirm that private keys are kept out of public website code and the release package.
- [ ] **Confirm the launch offer.** The current release is free early access, with payments disabled and AI off. Confirm that this is the intended public offer and that the website describes the available features accurately. Signed-PDF upload currently stores a copy; it does not collect or verify electronic signatures.
- [ ] **Verify real account emails.** From the final domain, test signup, confirmation, resend confirmation, login, logout and password recovery. Check actual inbox delivery and open the emailed links on a phone.
- [ ] **Verify the complete workspace.** Create a project, upload and play audio, save notes, fill and edit a contract, reopen it, download PDF and Word copies, and upload/download a signed PDF. Inspect the exported documents for layout problems.
- [ ] **Verify account privacy and persistence.** Use two accounts to confirm one cannot access the other's files, including through direct file/API links. Restart the backend and check that saved records and uploads remain available.
- [ ] **Check the public website on desktop and mobile.** Test navigation, forms, the editor, downloads and support links. Remove any developer-only notices or test controls that should not appear publicly.
- [ ] **Prepare backups and support.** Back up the database and uploaded files together, verify a restore in a separate environment, enable uptime/error alerts, and name the person handling user problems.
- [ ] **Complete the final release check.** Deploy the reviewed release, run the deployment checks on the host, repeat the key account and document tests on the final domain, and confirm how to restore the previous working release if needed.

Only if these features are included at launch:

- [ ] **Paid subscriptions:** Agree the price and billing period, use the intended owner's Stripe account, test checkout and subscription changes, decide how existing early-access users will be treated, and configure matching live credentials and webhooks before enabling payments. Keep free early access if paid plans are launching later.
- [ ] **AI assistance:** Confirm the intended features, provider account, usage costs and public descriptions, then test the feature before enabling it. Keep AI off if it is launching later.

Launch details to fill in:

- Final website domain: ____________________
- Support email: ____________________
- Account-email sender: ____________________
- Service owner / support contact: ____________________
- Launch date: ____________________

Developer reference: the support email is controlled by `SUPPORT_EMAIL`, the sender by `SMTP_FROM`, and website links/origin checks by `APP_ORIGIN` and `CORS_ORIGIN`. With the existing Vercel setup, `OWN_MASTERS_BACKEND_ORIGIN` selects the backend and `VITE_API_BASE_URL` stays empty. Free early access uses `BILLING_MODE=preview`; AI stays off with `AI_FEATURES_ENABLED=false`. Use `docs/initial-deployment.md`, `docs/account-email-setup.md` and `docs/stripe-billing.md` for the implementation steps. Run `npm run deploy:check -- --smtp` on the configured deployment host; that check does not prove actual inbox delivery.
