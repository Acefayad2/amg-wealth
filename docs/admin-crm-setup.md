# AMG admin communications setup

The `/admin/` interface uses AMG Portal Supabase authentication and isolated CRM storage. No contacts are imported and no texts can send from the repository alone.

## Required platform setup

1. The migration creates private `amg_private.crm_*` tables and authenticated RPCs without changing AMG app tables, roles, policies, data, or global signup settings.
2. Add an approved existing Supabase Auth user to `amg_private.crm_admins` only after their identity and account impact are confirmed. Never set a password from chat or expose it in code, logs, or commands.
3. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as Functions-scoped Netlify variables. The publishable key is safe for the browser; no service-role key is used by the website.
4. In Quo, create a dedicated API key for AMG. Add it as the Functions-scoped secret `QUO_API_KEY` and configure the verified AMG E.164 sender as `QUO_FROM_NUMBER`.
5. Verify Quo carrier registration and prepaid API messaging credits. Add contacts manually, record consent evidence, and verify the three group memberships.
6. Keep the portal's global delivery control disabled until production sending is approved. The database switch defaults to off, uses optimistic version checks, and records every change in the CRM audit trail.
7. If a dispatcher is later exposed through a protected scheduled function, it must call `integrations/quo-dispatch.mts`. That integration checks the database switch before claiming work and again before every recipient. Set `AMG_QUO_EMERGENCY_DISABLE=true` to stop delivery independently of the portal.

## Admin invitations

From `/admin/`, an existing CRM administrator can send a personal setup link by text to an approved recipient. Confirm the destination phone: anyone who receives the link can use it to create an admin account. Treat the link like a password. It expires 12 hours after issue or as soon as setup succeeds.

The recipient opens `/admin/setup/`, enters their email and a new password, and signs in at `/admin/`. Opening the link only checks its validity. Successful submission creates a Supabase Auth account, grants that user CRM access and marks the invitation accepted in one database transaction. The recipient does not need to request a text code or follow a confirmation email. A used or expired link directs them to sign in or request another invitation.

Deploy the invitation migrations before the `amg-admin-complete-invite` and `amg-admin-invite` Edge Functions. The issuer authenticates the inviting CRM admin, checks provider opt-outs and sends the personal link. The completion function validates the link on the server and uses Supabase's Auth Admin API. Keep the service-role key inside Supabase. Existing accounts retain their credentials; ordinary email/password sign-in and password recovery use the regular Auth endpoints.

## Safety behavior

- Only users listed in the private CRM admin allowlist can read or change CRM data.
- The delivery switch fails closed, can only be changed by a CRM admin, and never activates incomplete reminders or bypasses message-level eligibility checks.
- Quo connection status and the delivery switch are separate: a verified sender does not mean sending is enabled.
- Unknown consent is not treated as opt-in; opted-out contacts cannot be scheduled.
- Contact names are optional. Supported generic greetings are personalized at dispatch when a name exists; phone-only contacts receive a natural general greeting.
- The first provider-accepted CRM text to a contact includes `Reply STOP to opt out.` Quo message history is checked before every recipient; a recognized inbound opt-out keyword suppresses that contact in CRM. If the history check fails or exceeds its safe pagination limit, the message fails closed without sending.
- Group recipients are snapshotted when scheduled and consent is checked again immediately before dispatch.
- Each message has a unique idempotency key. A delivery is atomically marked `sending` before calling Quo; uncertain deliveries stay in that state for manual reconciliation instead of being automatically retried.
- Quo receives one E.164 recipient per request, matching its current API contract.
- Draft, scheduled, sending, sent, and failed states remain distinct.

## Local invitation regression checks

`npm test`, `npm run check`, and `npm run build` cover local code. For SQL behavior, install PGlite in an isolated test directory and run `PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-admin-invite-sql.mjs`. This uses an in-memory PostgreSQL fixture with synthetic Auth users and a local SHA-256 wrapper, not production Supabase. It verifies that invite redemption grants admin access exactly once, expired or reused links fail, and failed account creation leaves the invite usable. It also covers legacy phone identity checks, invitation resend suppression, hook replay limits, and database permissions. It does not establish live provider delivery or replace exact Edge Function checks.

### Contact edit conflict safeguard (2026-11-01)

The additive `20261101154000_contact_edit_conflicts.sql` migration introduces a
versioned contact-save RPC and exposes each contact's precise `updated_at` token.
The editor captures that token when opened. Stale edits fail with a refresh/retry
conflict instead of overwriting another admin's changes or a provider opt-out.
Every contact update advances the token, including multiple writes in one
transaction. Legacy unversioned creation remains supported; legacy updates fail
closed and require the refreshed client. Admin grants and consent policy are
unchanged. Apply this migration before publishing the matching API/UI bundle.

Local-only regression command (no live data or messages):
`PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/test-contact-conflicts-sql.mjs`.
This verifies stale-reader interleavings in isolated SQL, not simultaneous
production sessions or a multi-user load/capacity guarantee.

Release order: database migration first, then matching function/API and UI bundle.
Old open tabs receive HTTP 409 on unversioned edits and must refresh; do not
remove the database guard during frontend rollback. Preserve the trigger and
legacy fail-closed wrapper until every caller uses versioned edits. This change
does not address recurring-content lost updates or the separately reproduced
message-draft SQL ambiguity; those remain separate tracked findings.

## CRM database TLS repair

The serverless database pool trusts the public Supabase Root 2021 CA bundled in `netlify/functions/_shared/supabase-ca.mts` (SHA-256 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`, expires April 26, 2031). Certificate-chain and default hostname verification remain enabled. URL-level TLS options are removed before node-postgres parses the connection string, so they cannot override the explicit CA or weaken verification. The pool permits one connection per function instance. No credential or delivery-control change is required by this repair.
