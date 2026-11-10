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
| `/course/health/assessments/` | Three 105-minute Health mock exams, saved attempts and results (gated) | `course/health/assessments/` |
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
  IDs from email; changing it orphans every saved record), `AMG_APPS_SCRIPT_URL`
  (Google Sheets reporting, still `pending_authorization`).
- Session cookies use the `__Host-` prefix, so they belong to this domain only.

## Updating course content

Lesson content and the practice app are still authored and built in
`Acefayad2/amg-practice-exam`. To publish a change:

1. In that repo: `npm ci && npm run build`. The Health build verifies the checksum of every selected MP3.
2. Here: `scripts/sync-learning-course.sh /path/to/amg-practice-exam`. The script also copies the matching server answer keys and lesson hashes.
3. If you changed server code in the portal repo, copy it over by hand too
   (`access.mts` is `learning-access.mts` here).
4. `npm test`, open a pull request, check the deploy preview, merge.

The Google Apps Script reporting source (`scripts/google-sheets/Code.gs` in the
portal repo) still names `https://amg-exam-portal.netlify.app/api/learning` as its
fixed endpoint. Point it at `https://anointedmoneygroup.com/api/learning` before
reporting is enabled.
