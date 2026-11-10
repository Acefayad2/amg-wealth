# Matchup Google Calendar operations

Google Calendar is optional for each CFT. Authorization returns to the canonical main-domain CFT workspace. Existing Google identities refresh authorization rather than attempting to link the same identity twice.

## Background synchronization

The versioned function source lives in `integrations/matchup-backend/supabase/functions`. Deploy `amg-calendar-worker` with gateway JWT verification enabled. The worker requires a separate 32-character-or-longer `AMG_CALENDAR_WORKER_SECRET` and `AMG_CALENDAR_SYNC_ENABLED=true`, alongside the existing Google OAuth and Supabase credentials. Never commit credential values.

Provision matching Vault entries `amg_calendar_worker_secret` and `amg_calendar_worker_gateway_key` before applying `20261110200000_schedule_matchup_calendar_worker.sql`. The latter is the public gateway JWT, not the service-role key. The private invocation function is executable only by the service role; cron calls it every minute.

Database processing is also controlled by `amg_private.appointment_calendar_control.enabled`. Enable it deliberately after configuration. To pause processing, set this flag to false; the cron schedule may remain installed.

The worker checks busy ranges and creates/updates AMG-owned appointment events and meeting links. It does not add Google event attendees. Updates and deletion validate the AMG appointment ID on the existing event. Calendar credentials remain encrypted in Supabase Vault.

## Verification evidence

On November 10, 2026, an owner-only fictional appointment was synced to Google Calendar with a Google Meet link. The OAuth flow returned to `anointedmoneygroup.com/matchups/cft/`, and the CFT planner loaded private Google busy blocks. App branding and main-domain ownership were verified. Sensitive-scope review is a separate Google approval process.
