# Administrator workspace

Open **Admin** in the signed-in workspace navigation. Only verified, active administrator accounts can use `/dashboard/admin` or `/api/admin/*`. Administrator accounts use all workspace features without subscribing.

The library administrator is also the overall website administrator. Both use the existing `AccountUser.role = admin`; there is no separate library-only role or second admin login. **Manage users** and **Manage library** in Contract Filler open this workspace. The former `/dashboard/contract-templates` URL redirects to the Library section. Admin navigation derives from the authenticated account role and stays available if billing is unavailable. Server permissions are checked against the current database account on every request.

## Roles and navigation

| Account | Access | Sidebar |
| --- | --- | --- |
| Guest | Public information and authentication pages; no workspace APIs | No workspace sidebar |
| Confirmed, active member | Own projects, contracts, signed copies, support requests, account, and the shared library | Workspace: Dashboard, My contracts, Library & guides. Account: My account, Support, Your plan/Billing |
| Confirmed, active administrator | Website account/library/support management and activity, plus their own personal workspace | Administration: Overview, Users, Library, Support & Reports, Activity. Separate My workspace and Account sections |
| Unconfirmed or suspended account | Protected sessions rejected, including previously issued cookies | No signed-in workspace access |

Free and Pro are subscription plans, not extra roles. In early-access preview mode, members can export without subscribing. With Stripe enabled, exports and original downloads require an active qualifying Pro subscription; administrator accounts always retain those features without a subscription. A paid plan never grants administration permissions.

Desktop and mobile use the same role-specific menu. Administrator sections highlight the selected tab, including document/account detail URLs. The logo returns administrators to the admin overview and members to their dashboard. A refreshed role change removes stale administration links.

The older `/api/contracts/templates` library also requires an authenticated session. `includeAll=true` is administrator-only. Members can read schemas, view, and generate from approved, scanned sources; administrator access permits reviewing unapproved sources. Member-facing generated-contract counts include only the caller's work. Hiding sidebar items is additional UI guidance; API checks enforce these boundaries independently.

- **Overview:** live account, project, contract, library, signed-copy, and open-request counts; daily totals for the last 14 days in UTC. Active accounts have used the service within 30 days. Tracking begins with this release.
- **Users:** search accounts, filter by role and active/suspended/unconfirmed status, view basic details and usage counts, edit display names, assign member/admin roles, suspend with a reason, and reactivate. Active excludes unconfirmed email addresses. Name edits preserve credentials and sessions. Access changes revoke existing sessions and outstanding password-reset tokens. Users must log in again after reactivation or a role change. Administrators cannot remove their own access or suspend themselves; at least one verified active administrator must remain. Email addresses remain read-only and users manage their own passwords.
- **Library:** upload PDF/Word/RTF/text documents, download and review sources, edit display titles/categories/descriptions, select template or guide, and record a review and private note. To revise source wording, upload the revised document as a new item and archive the old one. Removal archives the item with a restore option. It remains available to owners of existing saved drafts and cannot be used by members to create new drafts. Bundled-library startup imports preserve archived states and manual metadata.
- **Support & Reports:** review member requests and document reports, assign priority/status, reply publicly within the member's Support page, and record internal staff notes. Sending a reply to a resolved/dismissed request reopens it. No email notifications are sent by this feature.
- **Activity:** searchable, paginated operational log. Admin changes and their audit events commit together. Credentials, document bodies, support messages, and internal note contents are excluded from the log.
- **Account:** edit your display name and change your password using your current password.

Members can open **Support** to create requests and follow up. **Report a problem** on library cards and guide previews links the report to that document. Member routes only return the caller's tickets and public replies. Admin tools provide account details and aggregate usage; they do not grant unrestricted browsing of members' private project files.

## Deployment

Run `npm run db:deploy` before starting the updated backend. Migration `20261113010000_administration` adds account state/activity, library metadata/archive/review fields, support tickets/replies, and the activity log. It does not delete existing data. `server/startTrial.mjs` applies migrations automatically on Render's trial setup.

Build and redeploy both the frontend and backend. No new environment variables or email-provider changes are required. Apply migrations separately to each target database; verification against an isolated test database does not migrate the configured development or cloud database.

Existing library administrators retain their `admin` role through this migration. An operator can explicitly create or recover an administrator with `node tools/maintenance/provisionAdmin.mjs` from the source checkout, supplying `ADMIN_EMAIL` and `ADMIN_PASSWORD` through the process environment. Recovery updates the password, verifies and reactivates that account, and revokes old sessions and recovery/confirmation tokens. It is never run automatically at startup.

## Validation

`tests/administration.test.mjs` checks real PostgreSQL account authorization, legacy template visibility and scoped counts, private-project/contract ownership even for administrators, user filters and name edits, suspension and role/session changes, competing administrator mutations, operator recovery, library archive/draft preservation, private notes, support isolation and replies, and usage totals. `tests/adminBrowser.test.tsx` checks role-specific desktop/mobile menus, selected admin sections, role refresh, navigation during billing outages, account edits and reactivation, confirmation steps, failed-save recovery, library management, and support/report forms.
