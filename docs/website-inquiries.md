# Website inquiries

The consultation form on the homepage submits to `submit-inquiry`. It stores each inquiry in `amg_private.crm_inquiries` before confirming success and opening the thank-you page. The former Google Apps Script submission is replaced by this flow.

Approved dashboard admins can choose **Inquiries** to read submissions, newest first. Records include the name, email, optional phone, selected interest, message, and submission time. Refresh reloads the list; pagination loads 25 records at a time without imposing a total-record cap.

## Deployment

- Apply `database/migrations/20261104143033_add_website_inquiries.sql` and `database/migrations/20261104144517_add_inquiry_service_role.sql` before deploying the functions. Both were applied to the AMG Portal project on November 4, 2026.
- Set `AMG_INQUIRIES_DATABASE_URL` as a secret in the Netlify Functions scope. The dedicated `amg_inquiries` login can insert/read inquiries, update only their ID for idempotent retries, and read admin user IDs. It cannot read SMS contacts or change admin membership. Its login credential is configured separately from the schema migration; never commit a password or connection URL. The server verifies TLS with the Supabase root CA.
- When the dedicated setting is absent, the functions fall back to the existing CRM database configuration. A configured but invalid inquiry URL fails without silently falling back.
- The table is private, has RLS enabled, and has no direct anonymous or authenticated API grants. Listing requires a Supabase-verified user and membership in `amg_private.crm_admins`.
- Netlify draft runtime variables use the deploy-preview context, even when the build uses `--context production`. When testing a draft, provide the database setting as a secret scoped to that specific deploy; do not broaden the site's shared environment-variable contexts.
- Inquiries remain separate from SMS contacts, groups, and messaging consent.

## Verification

Run `npm run build`, `npm run check`, and `npm test`. The inquiry tests cover validation, persistence-before-success, duplicate prevention, payload conflicts, authorization, pagination, safe rendering, and session cleanup.

For local visual checks, `/admin/?preview=inquiries`, `?preview=inquiries-empty`, and `?preview=inquiries-error` show synthetic fixtures. These modes are limited to localhost and do not bypass hosted admin authentication.

On a configured deployment, submit a synthetic inquiry and verify its exact database row. Repeat the same submission UUID and payload to confirm only one record remains. A different payload with that UUID must return HTTP 409. Anonymous listing must return HTTP 401. Remove only the synthetic test record after verification.

Verified on November 4, 2026 in draft `6aeb454814fbe2e39e48c7e9`: browser form submission reached the thank-you page after a confirmed database insert; identical retry returned 201 with one total record; a changed payload returned 409; anonymous listing returned 401. The exact synthetic record was removed afterward. Build, typecheck, and all 148 tests passed. Desktop and mobile dashboard views were checked using local sample data; a live signed-in admin session was not used for this check.

Published with all approved website previews on November 4, 2026: production deploy `6aeb46000d4b3a510f67a068` serves `https://anointedmoneygroup.com` from release commit `a7f3096`. A synthetic submission on the production domain returned 201 and was verified in the database, then removed by exact ID. Anonymous inquiry listing returned 401. The live resources page, guest link, schedule card, share-image metadata, and all 13 carrier logos were verified.
