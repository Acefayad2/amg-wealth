import { licensingSteps, stepUpdates, selectedStepsForStage } from '../../licensing-progress/steps.js';
import type { Config } from '@netlify/functions';
import { getInquiryPool } from './_shared/inquiry-db.mts';
import { getAuthenticatedUser } from './_shared/supabase.mts';
import { getCourseUser } from '../shared/course-user.ts';
import { normalizeUsPhone } from './_shared/us-phone.mjs';

const tasks = ['php_account', 'exam_booked', 'state_exam_passed', 'license_application', 'fingerprints', 'license_uploaded', 'aml_course', 'ce_courses', 'eo_active', 'carrier_request', 'appointed', 'first_check'] as const;
const learnerTasks = new Set(['php_account', 'exam_booked', 'license_application', 'fingerprints', 'license_uploaded', 'aml_course', 'ce_courses', 'eo_active', 'carrier_request']);
const tracks = new Set(['life', 'health', 'both']);
const examStatuses = new Set(['studying', 'scheduled', 'rescheduled', 'failed', 'passed']);
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const clean = (value: unknown, max = 160) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T12:00:00Z')) ? value : null;
const emailOf = (value: unknown) => {
  const email = clean(value, 254).toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
};
const personFields = `id, full_name AS name, email, phone, recruiter, recruiter_phone, state, track, exam_date, exam_status,
  blocker, next_action, follow_up_date, first_check_date, tasks, source, version, created_at, updated_at`;

async function adminId(request: Request): Promise<string | null> {
  if (!request.headers.get('authorization')?.startsWith('Bearer ')) return null;
  const { user } = await getAuthenticatedUser(request);
  const { rows } = await getInquiryPool().query('SELECT 1 FROM amg_private.crm_admins WHERE user_id = $1', [user.id]);
  if (!rows.length) throw Object.assign(new Error('AMG admin access required.'), { status: 403 });
  return user.id;
}

async function readBody(request: Request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw Object.assign(new Error('JSON required.'), { status: 415 });
  const raw = await request.text();
  if (raw.length > 8000) throw Object.assign(new Error('Request too large.'), { status: 413 });
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid request.'), { status: 400 });
  return body as Record<string, unknown>;
}

export default async function licensingPipeline(request: Request): Promise<Response> {
  if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, POST' } });
  try {
    if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 403);
    const administrator = await adminId(request);
    const learner = administrator ? null : await getCourseUser(request);
    if (!administrator && !learner) return json({ error: 'Sign in required.' }, 401);
    const pool = getInquiryPool();
    if (request.method === 'GET' && administrator) {
      const raw = new URL(request.url).searchParams.get('page') || '1';
      const page = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(page) || page < 1 || page > 100000) return json({ error: 'Invalid page.' }, 400);
      const query = clean(new URL(request.url).searchParams.get('q'), 80);
      const status = new URL(request.url).searchParams.get('status') || '';
      if (status && !examStatuses.has(status)) return json({ error: 'Invalid filter.' }, 400);
      const category = new URL(request.url).searchParams.get('category') || 'all';
      const licensed = "coalesce((tasks->'license_uploaded'->>'done')::boolean,false)";
      const eo = "coalesce((tasks->'eo_active'->>'done')::boolean,false)";
      const appointed = "coalesce((tasks->'appointed'->>'done')::boolean,false)";
      const due = `(follow_up_date <= (now() AT TIME ZONE 'America/New_York')::date AND NOT ${appointed})`;
      const categories: Record<string, string> = { all: 'true', unlicensed: `NOT ${licensed}`, licensed, eo_completed: eo, appointed, follow_ups_due: due };
      if (!Object.hasOwn(categories, category)) return json({ error: 'Invalid category.' }, 400);
      const categoryWhere = categories[category];
      const pattern = query ? `%${query.replace(/[\\%_]/g, '\\$&')}%` : null;
      const where = `($1::text IS NULL OR full_name ILIKE $1 ESCAPE '\\' OR email ILIKE $1 ESCAPE '\\' OR recruiter ILIKE $1 ESCAPE '\\') AND ($2::text IS NULL OR exam_status=$2)`;
      const [{ rows: list }, { rows: summary }] = await Promise.all([
        pool.query(`SELECT ${personFields} FROM amg_private.licensing_people WHERE ${where} AND (${categoryWhere}) ORDER BY updated_at DESC, id DESC LIMIT 25 OFFSET $3`, [pattern, status || null, (page - 1) * 25]),
        pool.query(`SELECT count(*) FILTER (WHERE ${categoryWhere})::int AS total, count(*)::int AS tracked,
          count(*) FILTER (WHERE NOT ${licensed})::int AS unlicensed,
          count(*) FILTER (WHERE ${licensed})::int AS licensed,
          count(*) FILTER (WHERE ${eo})::int AS eo_completed,
          count(*) FILTER (WHERE ${appointed})::int AS appointed,
          count(*) FILTER (WHERE ${due})::int AS follow_ups_due
          FROM amg_private.licensing_people WHERE ${where}`, [pattern, status || null]),
      ]);
      return json({ people: list, ...summary[0], category, page, page_size: 25 });
    }

    if (request.method === 'GET' && learner) {
      await pool.query(`INSERT INTO amg_private.licensing_people (full_name, email, source)
        VALUES ($1, $2, 'course') ON CONFLICT (lower(email)) DO NOTHING`, [learner.name, learner.email]);
      const { rows } = await pool.query(`SELECT id, full_name AS name, track, exam_date, exam_status, tasks, version, created_at, updated_at
        FROM amg_private.licensing_people WHERE lower(email) = $1`, [learner.email]);
      return json({ person: rows[0] });
    }
    const body = await readBody(request);
    if (body.action === 'save_person' && administrator) {
      const name = clean(body.name), email = clean(body.email) ? emailOf(body.email) : null;
      if (!name || (clean(body.email) && !email) || !tracks.has(body.track as string) || !examStatuses.has(body.examStatus as string)) return json({ error: 'Name, email, track, or exam status is invalid.' }, 400);
      const phone = clean(body.phone, 40);
      const normalizedPhone = phone ? normalizeUsPhone(phone) : null;
      if (phone && !normalizedPhone) return json({ error: 'Enter a valid US phone number.' }, 400);
      const recruiterPhone = clean(body.recruiterPhone, 40);
      const normalizedRecruiterPhone = recruiterPhone ? normalizeUsPhone(recruiterPhone) : null;
      if (recruiterPhone && !normalizedRecruiterPhone) return json({ error: 'Enter a valid US phone number for the recruiter / upline.' }, 400);
      const selected = body.completedSteps;
      if (selected !== undefined && (!Array.isArray(selected) || selected.some(id => !licensingSteps.some(step => step.id === id)))) return json({ error: 'Invalid licensing steps.' }, 400);
      const updates = selected === undefined ? {} : stepUpdates(selected as string[], 'admin');
      const examStatus = selected === undefined ? body.examStatus : (selected as string[]).includes('state_exam_passed') ? 'passed' : body.examStatus === 'passed' ? 'studying' : body.examStatus;
      const fields = [name, email, normalizedPhone, clean(body.recruiter), clean(body.state, 80), body.track,
        date(body.examDate), examStatus, clean(body.blocker, 500), clean(body.nextAction, 500), date(body.followUpDate), date(body.firstCheckDate), JSON.stringify(updates), normalizedRecruiterPhone, body.recruiterPhone !== undefined];
      let rows;
      if (body.id) {
        if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || !Number.isSafeInteger(body.expectedVersion)) return json({ error: 'Invalid person or version.' }, 400);
        ({ rows } = await pool.query(`UPDATE amg_private.licensing_people SET full_name=$1,email=$2,phone=$3,recruiter=$4,state=$5,track=$6,
          exam_date=$7,exam_status=$8,blocker=$9,next_action=$10,follow_up_date=$11,first_check_date=$12,tasks=tasks || $13::jsonb,recruiter_phone=CASE WHEN $15::boolean THEN $14::text ELSE recruiter_phone END,version=version+1,updated_at=now()
          WHERE id=$16 AND version=$17 RETURNING ${personFields}`, [...fields, body.id, body.expectedVersion]));
        if (!rows.length) return json({ error: 'This record changed. Refresh before saving.' }, 409);
      } else {
        ({ rows } = await pool.query(`INSERT INTO amg_private.licensing_people
          (full_name,email,phone,recruiter,state,track,exam_date,exam_status,blocker,next_action,follow_up_date,first_check_date,tasks,recruiter_phone)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING ${personFields}`, fields.slice(0,14)));
      }
      return json({ person: rows[0] });
    }
    if (body.action === 'set_stage') {
      if (!administrator) return json({ error: 'AMG admin access required.' }, 403);
      const stage = body.stage;
      if (!Number.isInteger(stage) || (stage as number) < 1 || (stage as number) > 6 || typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || !Number.isSafeInteger(body.expectedVersion)) return json({ error: 'Invalid person, step, or version.' }, 400);
      const updates = stepUpdates(selectedStepsForStage(stage as number), 'admin');
      const { rows } = await pool.query(`UPDATE amg_private.licensing_people SET tasks=tasks || $1::jsonb,
        exam_status=CASE WHEN $2::integer>=3 THEN 'passed' WHEN $2::integer=1 THEN 'studying'
          WHEN exam_status IN ('failed','rescheduled') THEN exam_status ELSE 'scheduled' END,
        version=version+1,updated_at=now() WHERE id=$3 AND version=$4 RETURNING ${personFields}`,
        [JSON.stringify(updates), stage, body.id, body.expectedVersion]);
      if (!rows.length) return json({ error: 'This record changed. Refresh before moving the slider.' }, 409);
      return json({ person: rows[0] });
    }
    if (body.action === 'set_step') {
      const step = licensingSteps.find(item => item.id === body.task);
      if (!step || typeof body.done !== 'boolean') return json({ error: 'Invalid licensing step.' }, 400);
      if (!administrator && step.official) return json({ error: 'This milestone is confirmed by AMG.' }, 403);
      const id = administrator ? body.id : null;
      if (administrator && (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) return json({ error: 'Invalid person.' }, 400);
      const updatedAt = new Date().toISOString();
      const updates = Object.fromEntries(step.tasks.map(key => [key, { done: body.done, updatedAt, source: administrator ? 'admin' : 'learner' }]));
      const condition = administrator ? 'id=$3' : 'lower(email)=$3';
      const { rows } = await pool.query(`UPDATE amg_private.licensing_people SET tasks=tasks || $1::jsonb,
        exam_status=CASE WHEN $2='state_exam_passed' THEN CASE WHEN $4 THEN 'passed' WHEN exam_status='passed' THEN 'studying' ELSE exam_status END
          WHEN $2='exam_booked' AND $4 AND exam_status='studying' THEN 'scheduled'
          WHEN $2='exam_booked' AND NOT $4 AND exam_status IN ('scheduled','rescheduled') THEN 'studying' ELSE exam_status END,
        version=version+1,updated_at=now() WHERE ${condition}
        RETURNING ${administrator ? personFields : 'id, full_name AS name, track, exam_date, exam_status, tasks, version, created_at, updated_at'}`,
        [JSON.stringify(updates), step.id, administrator ? id : learner!.email, body.done]);
      if (!rows.length) return json({ error: 'Person not found.' }, 404);
      return json({ person: rows[0] });
    }
    if (body.action === 'set_task') {
      if (typeof body.task !== 'string' || !tasks.includes(body.task as typeof tasks[number]) || typeof body.done !== 'boolean') return json({ error: 'Invalid checklist item.' }, 400);
      if (!administrator && !learnerTasks.has(body.task)) return json({ error: 'This milestone is confirmed by AMG.' }, 403);
      const id = administrator ? body.id : null;
      if (administrator && (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) return json({ error: 'Invalid person.' }, 400);
      const condition = administrator ? 'id=$3' : 'lower(email)=$3';
      const target = administrator ? id : learner!.email;
      const value = JSON.stringify({ done: body.done, updatedAt: new Date().toISOString(), source: administrator ? 'admin' : 'learner' });
      const { rows } = await pool.query(`UPDATE amg_private.licensing_people SET tasks=jsonb_set(tasks, ARRAY[$1::text], $2::jsonb, true), version=version+1, updated_at=now()
        WHERE ${condition} RETURNING ${administrator ? personFields : 'id, full_name AS name, track, exam_date, exam_status, tasks, version, created_at, updated_at'}`,
        [body.task, value, target]);
      if (!rows.length) return json({ error: 'Person not found.' }, 404);
      return json({ person: rows[0] });
    }
    return json({ error: 'Action not available.' }, 400);
  } catch (error) {
    const failure = error as { status?: number; code?: string; message?: string };
    if (failure.code === '23505') return json({ error: 'That email is already in the tracker.' }, 409);
    if (failure.status === 401 || failure.status === 403 || failure.status === 413 || failure.status === 415) return json({ error: failure.message }, failure.status);
    return json({ error: 'Licensing tracker could not save. Try again.' }, 503);
  }
}

export const config: Config = { path: '/api/licensing-pipeline' };
