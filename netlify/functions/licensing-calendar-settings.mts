import { randomBytes } from 'node:crypto';
import type { Config } from '@netlify/functions';
import { getAuthenticatedUser } from './_shared/supabase.mts';
import { getInquiryPool } from './_shared/inquiry-db.mts';
import { checkCalendarPin, hashUnlock } from './_shared/licensing-calendar-core.mjs';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
export default async function settings(request: Request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 403);
  try {
    const { user } = await getAuthenticatedUser(request);
    const pool = getInquiryPool();
    const { rows: admins } = await pool.query('SELECT 1 FROM amg_private.crm_admins WHERE user_id=$1', [user.id]);
    if (!admins.length) return json({ error: 'AMG admin access required.' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON required.' }, 415);
    const raw = await request.text();
    if (raw.length > 1000) return json({ error: 'Request too large.' }, 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400);
    if (body.action === 'unlock') {
      const { rows: attempts } = await pool.query(`INSERT INTO amg_private.licensing_calendar_access(admin_id,attempts) VALUES($1,1)
        ON CONFLICT(admin_id) DO UPDATE SET attempts=CASE WHEN licensing_calendar_access.window_started_at < now()-interval '15 minutes' THEN 1 ELSE licensing_calendar_access.attempts+1 END,
        window_started_at=CASE WHEN licensing_calendar_access.window_started_at < now()-interval '15 minutes' THEN now() ELSE licensing_calendar_access.window_started_at END RETURNING attempts`, [user.id]);
      if (attempts[0].attempts > 5) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      const { rows } = await pool.query('SELECT pin_hash FROM amg_private.licensing_calendar_settings WHERE singleton=true');
      if (!rows.length) return json({ error: 'Calendar settings have not been configured.' }, 503);
      if (!checkCalendarPin(body.password, rows[0].pin_hash)) return json({ error: 'The calendar password is incorrect.' }, 403);
      const unlock = randomBytes(32).toString('hex');
      await pool.query(`UPDATE amg_private.licensing_calendar_access SET attempts=0,unlock_hash=$2,unlock_expires_at=now()+interval '15 minutes' WHERE admin_id=$1`, [user.id, hashUnlock(unlock)]);
      return json({ unlock });
    }
    const unlock = request.headers.get('x-calendar-unlock') || '';
    if (!/^[a-f0-9]{64}$/.test(unlock)) return json({ error: 'Unlock calendar settings first.' }, 403);
    const { rows: access } = await pool.query('SELECT 1 FROM amg_private.licensing_calendar_access WHERE admin_id=$1 AND unlock_hash=$2 AND unlock_expires_at>now()', [user.id, hashUnlock(unlock)]);
    if (!access.length) return json({ error: 'Calendar settings are locked. Enter the password again.' }, 403);
    if (body.action === 'rotate') await pool.query('UPDATE amg_private.licensing_calendar_settings SET feed_token=$1,updated_at=now() WHERE singleton=true', [randomBytes(32).toString('hex')]);
    else if (body.action !== 'status') return json({ error: 'Unknown action.' }, 400);
    const { rows } = await pool.query('SELECT feed_token FROM amg_private.licensing_calendar_settings WHERE singleton=true');
    const feedUrl = `https://anointedmoneygroup.com/api/licensing-exams.ics?token=${rows[0].feed_token}`;
    return json({ feedUrl, googleUrl: 'https://calendar.google.com/calendar/u/0/r?cid=' + encodeURIComponent(feedUrl.replace('https:', 'webcal:')) });
  } catch (error) {
    const status = (error as { status?: number }).status;
    return json({ error: status === 401 ? 'Sign in required.' : 'Calendar settings could not load. Try again.' }, status === 401 ? 401 : 503);
  }
}
export const config: Config = { path: '/api/licensing-calendar-settings' };
