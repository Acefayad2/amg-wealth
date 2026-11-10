import type { Config } from '@netlify/functions';
import { getInquiryPool } from './_shared/inquiry-db.mts';
import { examCalendarIcs } from './_shared/licensing-calendar-core.mjs';
export default async function examsFeed(request: Request) {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  const token = new URL(request.url).searchParams.get('token') || '';
  const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response('Not found', { status: 404, headers });
  try {
    const pool = getInquiryPool();
    const { rows: access } = await pool.query('SELECT 1 FROM amg_private.licensing_calendar_settings WHERE singleton=true AND feed_token=$1', [token]);
    if (!access.length) return new Response('Not found', { status: 404, headers });
    const { rows } = await pool.query(`SELECT id,full_name AS name,track,exam_date::text,exam_time::text,updated_at,version FROM amg_private.licensing_people
      WHERE exam_date IS NOT NULL AND coalesce((tasks->'exam_booked'->>'done')::boolean,true) ORDER BY exam_date,exam_time NULLS LAST,id`);
    return new Response(examCalendarIcs(rows), { headers: { ...headers, 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="amg-licensing-exams.ics"' } });
  } catch { return new Response('Calendar temporarily unavailable.', { status: 503, headers }); }
}
export const config: Config = { path: '/api/licensing-exams.ics' };
