# Real confirmation emails, including delivery to Gmail

## Email design

All current application emails—confirmation (including resends), password
recovery and explicitly requested delivery tests—use one shared Own Masters
letter template in `server/lib/mail/letterTemplate.mjs`. It provides the logo, navy header,
pale background, rounded card and a clear action button when needed. Every letter
includes a plain-text alternative and the configured support address. Account
actions also include a copyable link and expiry information. The logo is embedded
in the message; it does not depend on a
public website or a remote image request. Replies use `SUPPORT_EMAIL` when set.

New email types should provide their content to `renderOwnMastersLetter`, rather
than creating another HTML layout. It supports ordinary letters without an action
button or expiry notice as well as account-action messages. This change adds no
new automatic email triggers. Each letter retains its own subject and purpose.

Run `npm run mail:preview` for a loopback-only design preview at
`http://127.0.0.1:8890/letters` (all letters), `/` (confirmation), `/reset`
(password recovery), and `/delivery-test`. It writes
standalone HTML under `.codex/account-email-preview/`, uses inactive example
links, and sends no email. `npm run mail:preview -- --write-only` just writes the
HTML files. Previews are excluded from deployment. Run `npm run test:email` to
check escaping, both message parts, logo embedding and local SMTP delivery.

The confirmation link still opens the confirmation page without consuming the
token; the user selects **Confirm email** there. Email design does not change the
one-use token, one-hour confirmation expiry or 30-minute reset expiry.

## Sender setup

Gmail is the recipient's inbox. Own Masters sends confirmation and reset emails
through its sender's SMTP service. Receiving them in Gmail does not require a
Google API key, Gmail API integration, or access to the recipient's Google account.

Local preview uses Mailpit and does not send external mail. Real inbox delivery
requires `EMAIL_DELIVERY_MODE=smtp` with a configured sender. Selecting a real
email address in the signup form does not change the delivery mode automatically.

## Connect the Own Masters sender when available

1. Choose the service that will send mail for the Own Masters address. Verify the
   sending address/domain with that provider and follow its SPF/DKIM instructions.
2. Get the provider's SMTP hostname, port, username, and SMTP password. These are
   sender credentials; Gmail recipients do not need to provide any token.
3. Open the private `.env` file locally and replace only the email settings using
   `tools/development/env.email.example` as a reference. Keep DATABASE_URL and other project settings.
   Store credentials in the file or deployment secret manager, not chat or a
   screenshot. Never put them in browser-side code or `VITE_` variables.
4. Set `EMAIL_DELIVERY_MODE=smtp` and use the verified Own Masters sender in
   `SMTP_FROM`. Port 465 uses TLS; other remote ports require STARTTLS. Keep
   `APP_ORIGIN=http://127.0.0.1:5174` while testing on this computer. Use the real
   HTTPS website origin at deployment.
5. Run `npm run mail:check`. This verifies SMTP connectivity/authentication without
   sending a message. Restart the API after editing `.env`.
6. To explicitly test a Gmail inbox you control, run:

   ```sh
   npm run mail:check -- --to your-test-inbox@gmail.com
   ```

   This sends one clearly labeled test email. SMTP acceptance does not prove inbox
   delivery; check Gmail's inbox and spam folder. Then sign up with a test account
   and verify the actual confirmation and password-reset links.

After switching to real delivery, the local-preview notice disappears
automatically. Localhost confirmation links only work on the computer running the
app; using a phone or another device requires a reachable website address. Follow
`auth-deployment.md` when deploying.

If a Gmail account is ever used as a temporary **sender**, it needs its own Gmail
SMTP credentials (such as an eligible Google App Password), not a generic API key.
That is separate from simply delivering to Gmail recipients.

References: [Nodemailer SMTP delivery](https://nodemailer.com/smtp/)
and [Google App Passwords](https://support.google.com/accounts/answer/185833).
