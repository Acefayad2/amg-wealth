# Practice results dashboard

The new Exam results tab uses the existing CRM admin sign-in and admin membership
check. It shows self-reported practice scores, not official licensing results.
Historical TWR rows are not imported. It sends no result emails.

## Release order

1. Review and apply `database/migrations/20261109165801_add_practice_results.sql`
   to the existing CRM database. This adds a private table only, with RLS and no
   client grants; do not change existing access or create credentials.
2. Verify the existing server-only CRM connection can read/write the new table.
3. Publish backend/dashboard together with the practice frontend that posts to
   `/api/practice-results`. Do not point the frontend to the old TWR endpoint as
   a fallback. On failure the learner must retain the result and retry safely.
4. Check unauthenticated admin GET denies access, current admin can view results,
   and a synthetic submission in an isolated test environment is visible once.
   Do not create real contacts or send real emails during QA.

POST requires a UUIDv4 attemptId, name/email, the Health exam type, integer score,
wrong/skipped counts totaling 90, and boolean earlyFail. Percentage and pass are
recalculated (70% threshold). Duplicate identical attempt IDs are accepted;
conflicting reused IDs return409. Origin/JSON checks, an8KB body limit, and
Netlify IP/domain rate limits restrict intake. This is self-reported input,
not a server-scored or authenticated certification workflow.

Admin GET is paginated25 at a time, no-store, authenticated with the existing
Supabase user verification and checked against `amg_private.crm_admins`.
Do not use the broadly shared AMG spreadsheet as result storage.

## Validation

Typecheck, build and Node tests run locally. Live migration and production
end-to-end checks are not included in these unit results. Browser launch was
blocked by environment socket restrictions; synthetic DOM tests cover loading,
errors, pagination, escaping, and sign-out response races.
