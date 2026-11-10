# Stripe billing: preview now, activate later

## Current behavior

`BILLING_MODE=preview` is the default even when no billing variables exist. The
homepage links to `/pricing`; the dashboard includes **Your plan**. The initial
website shows one free early-access plan, working PDF/Word export buttons and
no Pro upsell, disabled checkout preview, or card fields.
Checkout/portal requests are rejected, no Stripe API is called, and current
workspace/export access is preserved. Preview does not mark anyone as paid.

The initial paid product is a single recurring Pro subscription: PDF/DOCX exports
and original contract template downloads. Free includes editing/saving drafts,
song projects, guides, notes, progress, and access to users' own signed copies.
Project/storage quotas, AI credits, team seats, premium-only text, and one-off
contract purchases are future product work and are not advertised as included.
Editable previews expose document text; this charges for export services, not
copy protection of text already supplied to the browser.

## Database and endpoints

Apply migration `20261104010000_billing_foundation` with `npx prisma migrate deploy`
and regenerate with `npx prisma generate`. `BillingAccount` belongs to an
`AccountUser` and stores Stripe IDs and current subscription state.
`BillingWebhookEvent` records processed event IDs atomically with state updates.
Old generated documents are retained with a null owner; only an administrator
may access those unassigned files. Newly generated documents record their owner.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/billing/catalog` | Public | Preview status or the actual configured recurring Stripe price |
| `GET /api/billing/status` | Signed-in account | Current account's plan, subscription status, export access |
| `POST /api/billing/checkout` | Signed-in account + trusted mutation | `{ "plan": "pro", "returnTo": "/dashboard/contracts" }` |
| `POST /api/billing/portal` | Signed-in account + trusted mutation | Creates a portal session for that account's stored customer |
| `POST /api/billing/webhook` | Stripe signature | Reads raw bytes and reconciles subscription changes |

Checkout never trusts client-supplied amounts, price IDs, user/customer IDs, or
redirect origins. Server configuration selects the Price; cookie authentication
selects the owner; APP_ORIGIN selects the return origin. Return paths are restricted
to dashboard routes. An account lock, stored Checkout session, and Stripe
idempotency keys prevent concurrent clicks creating duplicate open checkouts.
Existing live/incomplete/unpaid subscriptions must be managed through the portal.
One customer can have a single current Pro subscription in this implementation.

Stripe webhooks bypass browser cookie/CSRF checks only on the exact webhook route;
the official SDK verifies the raw payload with `Stripe-Signature`. Browser billing
mutations retain authentication and trusted-origin/header checks. A browser
`?checkout=returned` query never grants access; the UI polls stored server status
and reports pending confirmation until the webhook is processed.

Supported events: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`,
and `invoice.payment_failed`. The handler retrieves current Stripe subscription
state while holding the account lock, so old event snapshots cannot restore
canceled access. Unknown customers are never linked by email or metadata.
Duplicate event receipts do not repeat changes; failures roll back for retry.

In Stripe mode, only active/trialing subscriptions for the configured Pro price
with a future period end allow exports. Past-due, incomplete, unpaid, paused,
canceled, expired, and other-price subscriptions do not grant export access.
Scheduled cancellation keeps access through the paid period. Administrators keep
internal export access. There is no demo sign-in.
Drafts/projects are retained on downgrade. Export checks cover the filing engine,
original contract sources, and legacy generation/download paths. User-uploaded
signed copies and guides stay accessible. The older browser-generated RTF text
export is a basic text copy, not a paid PDF/DOCX export.

## Activate using the eventual owner's account

1. Confirm the business can use Stripe in its registration country. Obtain access
   to the intended account; never put secrets in chat, source control, or VITE_
   variables. No publishable key is needed for hosted Checkout redirects.
2. Start in a Stripe sandbox. Create an **Own Masters Pro** product and one active
   recurring, fixed, per-unit, licensed Price. Choose the actual amount, currency,
   and period with the owner. The UI reads the price from Stripe; no placeholder
   amount needs changing in React.
3. Configure the customer portal on that same account. Enable payment-method
   updates, invoices, and cancellation. Keep plan switching disabled unless the
   new prices are explicitly supported by this application.
4. Configure the server (sandbox values first):

   ```dotenv
   BILLING_MODE=stripe
   APP_ORIGIN=https://your-real-domain.example
   STRIPE_SECRET_KEY=sk_test_REPLACE_IN_PRIVATE_ENVIRONMENT
   STRIPE_WEBHOOK_SECRET=whsec_REPLACE_IN_PRIVATE_ENVIRONMENT
   STRIPE_PRO_PRICE_ID=price_REPLACE_IN_PRIVATE_ENVIRONMENT
   ```

   HTTPS is required in production. Local development allows APP_ORIGIN
   `http://127.0.0.1:5174`. An incomplete Stripe configuration stops API startup
   instead of enabling charges or silently granting paid access.
5. Register `https://your-real-domain.example/api/billing/webhook` for the supported
   events above. For local sandbox work, use the Stripe CLI:

   ```text
   stripe listen --forward-to http://127.0.0.1:8787/api/billing/webhook
   ```

   Use that listener's signing secret locally; deployed endpoints have separate
   signing secrets. Keep the handler reachable and monitor failed deliveries.
6. Restart the API. Run the automated tests and then real sandbox checks: complete
   Checkout; abandon/expire Checkout and try again; delayed webhook; duplicate
   webhook; declined payment; renewal failure; cancellation at period end;
   immediate cancellation; portal return; other-account export denial; and
   re-subscription after cancellation. A successful redirect must never be enough
   to activate Pro. Test representative PDF and Word exports with LibreOffice.
7. Before live activation, finalize public pricing, refund/cancellation policy,
   Terms/Privacy/Contact pages, tax configuration appropriate to the business,
   and any grandfathering decision for existing users. Preview users become Free
   when Stripe mode is activated; saved documents are not deleted.
8. Replace sandbox values with matching live account/Price/webhook values and
   repeat the launch checks. Sandbox checkout has not been exercised against a
   real account in this change; automated tests use a Stripe API stub and actual
   SDK signature verification. Keep `BILLING_MODE=preview` until this is done.

Refunds alone do not cancel a Stripe subscription. For this first release,
operations must also cancel the subscription when revoking access after a refund
or dispute, using the documented refund policy. The subscription webhook then
updates access. Automated dispute/refund access policy, subscription state
reconciliation jobs for prolonged webhook outages, proration/plan changes, and
tax automation are separate follow-up work. Do not promise these in plan copy.

## Checks

`npm run test:integration` covers preview safety, server-selected prices/account
isolation, concurrent Checkout, signed webhook processing, stale/duplicate events,
failed renewal/cancellation/expiration access, and placeholder UI behavior.
`npm run typecheck` and `npm run build` validate the frontend. Existing account,
project, contract-progress, and recovery suites should stay green in preview.

Official references: [Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions.md?payment-ui=stripe-hosted),
[subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks),
[webhook verification](https://docs.stripe.com/webhooks), and
[customer portal](https://docs.stripe.com/customer-management/integrate-customer-portal).
