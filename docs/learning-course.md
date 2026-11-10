# AMG Learning on anointedmoneygroup.com

The licensing course, the practice tests and the study guides are served from
this site. They used to live on the separate `amg-exam-portal` Netlify site
(repo `Acefayad2/amg-practice-exam`), which this site proxied or redirected to.

| Path | What it is | Where it lives here |
| --- | --- | --- |
| `/licensing` | Public licensing support page | `licensing.html` |
| `/login/` | Shared AMG access code, then name + email | `login/` |
| `/course/` | Maryland Life course and assessments (gated) | `course/` |
| `/course/health/` | Maryland Accident & Health: 60 narrated lessons and 484 lesson questions (gated) | `course/health/` |
| `/course/health/assessments/` | One untimed Health mock exam, rotating questions, saved attempts and results (gated) | `course/health/assessments/` |
| `/practice/`, `/practice/health/` | Practice test app (single-page app) | `practice/index.html`, `practice-assets/` |
| `/guides/*.docx` | Life and A&H study guides | `guides/` |
| `/api/access` | Code check, learner session cookies | `netlify/functions/learning-access.mts` |
| `/api/learning` | Saved lesson progress and practice attempts | `netlify/functions/learning.mts` |
| gate on `/course/*` | Redirects to `/login/` without a session | `netlify/edge-functions/course-access.ts` |

Shared server code is in `netlify/shared/` and `netlify/functions/_shared/learning-*.mjs`.

## Data and settings

- Learner progress is stored in this site's Netlify Blobs store `amg-learning-v1`
  (records were copied over from the exam portal site when the course moved).
- Environment variables (copied from the exam portal): `AMG_REGISTRATION_CODE`
  (shared access code), `AMG_SESSION_SECRET` (signs sessions and derives learner
  IDs from email; changing it orphans every saved record). The former
  `AMG_APPS_SCRIPT_URL` spreadsheet connection is not used by the live course.
- Session cookies use the `__Host-` prefix, so they belong to this domain only.
- Lesson saves and unfinished exam attempts update the private learner index
  automatically. The Licensing coursework view reads those saved records and
  refreshes every 15 seconds while open and visible, preserving expanded
  checklists. No learner or coordinator sync button is required. Failed uploads
  retain pending work and retry automatically; a true save failure is never
  presented as a successful cloud save.

## Updating course content

Lesson content and the practice app are still authored and built in
`Acefayad2/amg-practice-exam`. To publish a change:

1. In that repo: `npm ci && npm run build`. The Health build verifies the checksum of every selected MP3.
2. Here: `scripts/sync-learning-course.sh /path/to/amg-practice-exam`. The script also copies the matching server answer keys and lesson hashes.
3. If you changed server code in the portal repo, copy it over by hand too
   (`access.mts` is `learning-access.mts` here).
4. `npm test`, open a pull request, check the deploy preview, merge.

The historical Google Apps Script integration remains in the source repository
for compatibility. Production `/api/learning` explicitly selects dashboard
reporting and does not call it or send learner tokens to it.

## Deleting a person and their learning history

The Licensing card's **Delete person** action removes the version-checked pipeline row and all linked saved Life/Health lesson records, diagnostic/mock attempts (finished or unfinished), reporting state, and coordinator snapshot. Learning records are linked by the person's saved email. The action holds the pipeline row lock until the storage purge succeeds; failures keep the row available for retry.

A small hashed reset marker rotates that learner's storage namespace. Open pages cannot upload the erased generation again. Returning learners receive an empty namespace, and the browser adapter does not load their old local cache. Simply refreshing an old checklist or empty classroom does not recreate the deleted pipeline row or coordinator snapshot; admins can explicitly add the person again, and new course activity is tracked as new progress.

Production identity/reset guards live in this repository's `learning.mts` and `learning-deletion.mjs`. Preserve them when importing future lesson builds. The source account adapter in `amg-practice-exam` also supports the server's stable `accountId` binding when the storage namespace changes.
