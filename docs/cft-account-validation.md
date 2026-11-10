# CFT signup and personal workspace

The personal CFT portal is scoped to the authenticated trainer, including accounts that also hold an administrator role. The public workspace RPC checks ownership for every mutation and filters all loaded trainer, appointment, availability, and recurring-schedule records. Broker administration remains a separate workspace.

Signup uses the shared AMG verification code and a separate personal password. Supabase's breached-password protection remains enabled. Provider rejections for common or breached passwords return a specific, actionable message rather than a generic account-creation error. Failed signup preserves entered form values.

## Verification — November 10, 2026

- A fresh account was created through the production form in an isolated browser session and signed in immediately.
- A common test password was rejected with the specific password guidance; a unique personal password succeeded.
- Eight availability slots were saved, persisted after refresh, and remained visible after signing out and signing back in.
- Database transaction tests checked regular-CFT and administrator personal-workspace isolation, foreign mutation denial, direct-table RLS, and own-schedule writes. All test writes were rolled back.
- The synthetic browser account remained paused for matching throughout testing and was removed afterward.

Run `npm test` in the root and `integrations/matchup-ui`. The database authorization regression is `database/tests/individual-cft-workspaces.sql` and is transactional.
