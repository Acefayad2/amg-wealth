# AMG admin communications setup

The `/admin/` interface uses AMG Portal Supabase authentication and isolated CRM storage. No contacts are imported and no texts can send from the repository alone.

## Required platform setup

1. The migration creates private `amg_private.crm_*` tables and authenticated RPCs without changing AMG app tables, roles, policies, data, or global signup settings.
2. Add an approved existing Supabase Auth user to `amg_private.crm_admins` only after their identity and account impact are confirmed. Never set a password from chat or expose it in code, logs, or commands.
3. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as Functions-scoped Netlify variables. The publishable key is safe for the browser; no service-role key is used by the website.
4. In Quo, create a dedicated API key for AMG. Add it as the Functions-scoped secret `QUO_API_KEY` and configure the verified AMG E.164 sender as `QUO_FROM_NUMBER`.
5. Verify Quo carrier registration and prepaid API messaging credits. Add contacts manually, record consent evidence, and verify the three group memberships.
6. Only after explicit production-send approval, adapt and expose `integrations/quo-dispatch.mts` through an authenticated scheduled function and set `AMG_QUO_SEND_ENABLED=true`.

## Safety behavior

- Only users listed in the private CRM admin allowlist can read or change CRM data.
- Unknown consent is not treated as opt-in; opted-out contacts cannot be scheduled.
- Group recipients are snapshotted when scheduled and consent is checked again immediately before dispatch.
- Each message has a unique idempotency key. A delivery is atomically marked `sending` before calling Quo; uncertain deliveries stay in that state for manual reconciliation instead of being automatically retried.
- Quo receives one E.164 recipient per request, matching its current API contract.
- Draft, scheduled, sending, sent, and failed states remain distinct.
