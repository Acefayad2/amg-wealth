# Recurring draft edit conflicts — 2026-11-01

Prepared from main `eeaca4ba751316f53ff7603359a49b1eb46b9254`.

Previously, an admin's old editor could overwrite another admin's newer content.
The status RPC also accepted a null expected version because SQL `<> NULL` is
unknown rather than true. The isolated SQL harness reproduces both before the fix.

The additive migration introduces a versioned save RPC, retaining existing
validations, shared-admin editing, create idempotency, activation requirements,
and active-reminder edit exclusion. Legacy creation stays supported; legacy
updates fail closed with SQLSTATE 40001. Every reminder update receives a strictly
increasing timestamp, including status changes in the same transaction. The
existing status RPC now uses `IS DISTINCT FROM`, rejecting null tokens.

The editor snapshots the timestamp and immutable schedule fields when opened,
not at submission after shared state may refresh. API forwarding preserves
PostgreSQL microseconds; existing 40001 handling returns HTTP 409. A rejected
editor remains open with its content and a refresh/retry instruction. Close,
refresh, and reopen to capture a fresh version. Saving remains draft-only in the
API; dispatch settings and reminder activation are untouched.

## Verification

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test-recurring-conflicts-sql.mjs
npm run check
npm test
npm run build
```

`DRAFT_MIGRATION=/path/to/20261101155305_draft_edit_target_name.sql` can additionally
replay the separately reviewed predecessor while it awaits repository merge.
Fixtures use in-memory PGlite, synthetic identities and sequential stale-reader
interleavings. They do not prove real multi-session throughput or authenticated
production UI behavior. Four VM tests exercise the actual editor/save functions.

## Release order / rollback

Local preparation only until the release owner authorizes publication and release.
Apply the additive database migration before deploying the matching API/UI.
Old open tabs safely receive 409 instead of overwriting newer content. Do not
remove the database guard when reverting frontend code: retain it even though
legacy edit clients then require refresh/redeployment. Preserve contact conflict
protection, draft correction, grants, existing reminder data, and sending OFF.
