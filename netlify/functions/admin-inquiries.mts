import { getInquiryPool } from './_shared/inquiry-db.mjs';
import { getAuthenticatedUser } from './_shared/supabase.mjs';
import { createInquiryListHandler } from './_shared/inquiries.mjs';

export default createInquiryListHandler({
  authenticate: async req => (await getAuthenticatedUser(req)).user,
  isAdmin: async id => {
    const { rows } = await getInquiryPool().query('SELECT 1 FROM amg_private.crm_admins WHERE user_id = $1', [id]);
    return rows.length === 1;
  },
  list: async (page, pageSize) => {
    const { rows } = await getInquiryPool().query(`
      SELECT (SELECT count(*)::integer FROM amg_private.crm_inquiries) AS total,
        COALESCE((SELECT jsonb_agg(item ORDER BY item.created_at DESC, item.id DESC) FROM (
          SELECT id, full_name, email, phone, interest, message, created_at
          FROM amg_private.crm_inquiries ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2
        ) item), '[]'::jsonb) AS inquiries`, [pageSize, (page - 1) * pageSize]);
    return rows[0];
  },
});
