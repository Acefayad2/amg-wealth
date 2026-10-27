# AMG admin communications setup

The `/admin/` interface is code-complete but intentionally configuration-locked. No contacts are imported and no texts can send from the repository alone.

## Required platform setup

1. Enable Netlify Identity for `amg-wealth`, use invite-only registration, invite the approved administrators, and assign the `admin` role. A role change takes effect on the next login or token refresh.
2. Provision an approved Postgres database, apply `database/migrations/20261027183000_create_admin_sms_crm.sql`, and add its connection string as the Functions-scoped secret `AMG_CRM_DATABASE_URL`.
3. In Quo, create a dedicated API key for AMG. Add it as the Functions-scoped secret `QUO_API_KEY` and configure the verified AMG E.164 sender as `QUO_FROM_NUMBER`.
4. Verify Quo carrier registration and prepaid API messaging credits. Add contacts manually, record consent evidence, and verify the three group memberships.
5. Only after an explicit production-send approval, expose `integrations/quo-dispatch.mts` through an authenticated scheduled function and set `AMG_QUO_SEND_ENABLED=true`.

## Safety behavior

- Only `admin` Identity users can read or change CRM data.
- Unknown consent is not treated as opt-in; opted-out contacts cannot be scheduled.
- Group recipients are snapshotted when scheduled and consent is checked again immediately before dispatch.
- Each message has a unique idempotency key. A delivery is atomically marked `sending` before calling Quo; uncertain deliveries stay in that state for manual reconciliation instead of being automatically retried.
- Quo receives one E.164 recipient per request, matching its current API contract.
- Draft, scheduled, sending, sent, and failed states remain distinct.
