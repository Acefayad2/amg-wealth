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

## Admin invitation prerequisites

The invitation implementation is intentionally inert until its separate database migration, Supabase Edge Functions, and a supported phone-verification provider are approved and configured.

1. Apply `20261030163547_admin_invitation_onboarding.sql` only after the exact invitee phone and full CRM-admin access have been approved. It adds a private invitation ledger and restricted RPCs; it does not add a user or grant access by itself.
2. Deploy `supabase/functions/amg-admin-invite` and `supabase/functions/amg-admin-phone-otp`. Supabase supplies its service-role credential inside the trusted Edge Function runtime; do not copy that credential into Netlify or browser code.
3. The no-new-provider option is the draft `amg-auth-sms-hook` Edge Function. It verifies Supabase's Standard Webhooks signature, reuses the existing project-scoped Quo secret and fixed AMG sender, checks Quo opt-out history, and sends only the six-digit Auth OTP. Quo is not a built-in Supabase phone provider. Enabling this option still requires a new hook-signing secret, deployment with JWT verification disabled (the hook authenticates the signature instead), enabling phone Auth with automatic phone confirmation off, registering the exact hook URL, and explicit approval for Auth configuration changes and any Quo SMS usage charges.
4. Verify that Supabase email confirmation is required for email changes. Do not activate this flow with automatic email confirmation enabled: the acceptance RPC relies on `email_confirmed_at` as proof that the recipient controls the chosen address.
5. Keep `https://anointedmoneygroup.com/admin/setup/` in the exact Supabase Auth redirect allowlist. The admin invitation function sends one private, expiring Quo link to the approved phone only after checking provider opt-out history.
6. The recipient opens that link, enters the same phone, and can request at most five OTPs, no more than once per minute, before the invitation expires. After verifying the OTP, they choose their own email, create and confirm a strong password, and verify the chosen email. The acceptance RPC derives phone and email from `auth.users`; it grants CRM admin only when both are confirmed and match the invitation-bound user.
7. The browser OTP endpoint permits only the production `https://anointedmoneygroup.com` origin, including preflight. Auth phone values with or without a leading plus are compared through strict canonicalization. The signed hook also requires the provisioned user and a fresh private-token-authorized request. A private delivery ledger atomically consumes each request and records only webhook identifiers and outcomes, never OTPs. Concurrent/replayed hook events cannot submit another provider message; failed, uncertain, or still-sending outcomes require a new explicitly requested OTP and consume the existing lifetime five-request allowance. Prepared or uncertain invitation sends require manual provider reconciliation even after expiry, rather than blind resend. The signed Auth hook has one four-second request budget (below Supabase’s five-second HTTP-hook limit), including body reads, database claims, opt-out history, provider calls and outcome recording. It reserves time for an outcome write, aborts timed-out operations, and refuses provider submission when insufficient time remains; an unrecorded outcome leaves the durable sending claim blocked.
8. A forwarded bearer link alone cannot grant access because the holder still needs the invited phone's OTP and the chosen email verification. Expired, mismatched, unconfirmed, uncertain, already accepted, and failed invitations remain blocked. The ledger records the unconfirmed phone-only Auth user created by this flow so an expired invitation can be safely reissued to that same account. Any unrelated existing phone account is never overwritten and requires administrator review. If it is confirmed as the intended person's account, use a specifically approved existing-account grant and the normal recovery flow; if it is an abandoned unconfirmed account, separately approve its targeted removal before reinviting.

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

`npm test`, `npm run check`, and `npm run build` cover local code. For SQL behavior, install PGlite in an isolated test directory and run `PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/test-admin-invite-sql.mjs`. This uses an in-memory PostgreSQL fixture with synthetic Auth users and a local SHA-256 wrapper, not production Supabase. It verifies migration parsing, normalized phone identity, phone/email verification gates, invitation resend suppression, hook replay/request limits, and privilege denial. It does not establish live provider delivery or replace exact Edge Function checks.
