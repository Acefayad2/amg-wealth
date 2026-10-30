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
3. Enable Supabase phone authentication with a supported SMS provider (Twilio, MessageBird, Vonage, TextLocal, or an approved Send SMS Hook). Quo is not a built-in Supabase phone provider. Using Quo for OTPs requires a separately reviewed signed Send SMS Hook, its own hook secret, rate-limit/CAPTCHA review, and explicit approval for authentication SMS charges and Auth configuration changes.
4. Verify that Supabase email confirmation is required for email changes. Do not activate this flow with automatic email confirmation enabled: the acceptance RPC relies on `email_confirmed_at` as proof that the recipient controls the chosen address.
5. Keep `https://anointedmoneygroup.com/admin/setup/` in the exact Supabase Auth redirect allowlist. The admin invitation function sends one private, expiring Quo link to the approved phone only after checking provider opt-out history.
6. The recipient opens that link, enters the same phone, verifies a separate Supabase OTP, chooses their own email, creates and confirms a strong password, and verifies the chosen email. The acceptance RPC derives phone and email from `auth.users`; it grants CRM admin only when both are confirmed and match the invitation-bound user.
7. A forwarded bearer link alone cannot grant access because the holder still needs the invited phone's OTP and the chosen email verification. Expired, mismatched, unconfirmed, uncertain, already accepted, and failed invitations remain blocked. An existing phone Auth account is not overwritten; an administrator must review that account instead.

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
