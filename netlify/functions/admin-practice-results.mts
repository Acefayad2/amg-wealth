import type { Config } from '@netlify/functions';
import { getPool } from './_shared/db.mjs';
import { getAuthenticatedUser } from './_shared/supabase.mjs';
import { createInquiryListHandler } from './_shared/inquiries.mjs';
const listHandler = createInquiryListHandler({
  authenticate: async req => (await getAuthenticatedUser(req)).user,
  isAdmin: async id => (await getPool().query('SELECT 1 FROM amg_private.crm_admins WHERE user_id=$1', [id])).rows.length === 1,
  list: async (page, pageSize) => {
    const { rows } = await getPool().query(`SELECT (SELECT count(*)::integer FROM amg_private.practice_results) AS total,
      COALESCE((SELECT jsonb_agg(item ORDER BY item.created_at DESC, item.id DESC) FROM
      (SELECT id,full_name,email,exam_type,score,total,wrong,skipped,early_fail,percentage,passed,created_at
       FROM amg_private.practice_results ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2) item), '[]'::jsonb) AS inquiries`, [pageSize,(page-1)*pageSize]);
    return rows[0];
  },
});
export default async (req: Request) => {
  const response = await listHandler(req);
  const data = await response.json();
  if (response.ok) { data.results = data.inquiries; delete data.inquiries; }
  else if (response.status === 503) data.error = 'Practice results could not be loaded. Please try again.';
  return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
};
export const config: Config = { path: '/api/admin/practice-results' };
