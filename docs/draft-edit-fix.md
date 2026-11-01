# Draft message edit correction — 2026-11-01

Prepared on main `eeaca4ba751316f53ff7603359a49b1eb46b9254`.

An existing PL/pgSQL variable and column both named `target_name` made every
existing-draft edit fail with SQLSTATE 42702 before the ownership guard could
return its intended result. Migration `20261101155305_draft_edit_target_name.sql`
renames only the local variable to `resolved_target_name`. The function signature,
column, security-definer/search-path configuration, grants, ownership predicate,
status restrictions, recipient eligibility/limit, and idempotency behavior are unchanged.
No frontend or contact-conflict files are changed. Recurring content conflict
protection remains a separate issue, not fixed by this migration.

## Checks

Run in an isolated fixture database, never against production:

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test-draft-edit-sql.mjs
npm run check
npm test
npm run build
```

The SQL harness replays the relevant existing migrations with synthetic admins
and contacts. It first reproduces 42702, then verifies the exact rename-only
function diff, owner edit success/name resolution, other-admin and non-draft
rejection, retry idempotency and cross-admin key rejection, pending/opted-out
exclusion, invalid targets, group snapshots, 100-recipient cap, anonymous denial,
and unchanged RPC execution privileges. This is not a real multi-session load
test or authenticated production UI test.

## Release and rollback

This is local preparation only until the release owner authorizes application.
Apply the additive migration via the established database release process; no
frontend deployment is necessary for this correction. Verify the installed
function definition read-only and keep test writes synthetic/off production.
Do not replace it with an older function definition casually: that restores the
known broken draft-edit behavior. A rollback must be scoped to this function and
must not revert unrelated contact guards, invitations, grants, or data.
