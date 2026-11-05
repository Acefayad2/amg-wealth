import type { Config } from '@netlify/functions';
import { getInquiryPool } from './_shared/inquiry-db.mjs';
import { createInquirySubmitHandler } from './_shared/inquiries.mjs';

export default createInquirySubmitHandler(async inquiry => {
  try {
    const result = await getInquiryPool().query(`
    INSERT INTO amg_private.crm_inquiries (id, full_name, email, phone, interest, message)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
    WHERE crm_inquiries.full_name = EXCLUDED.full_name
      AND crm_inquiries.email = EXCLUDED.email
      AND crm_inquiries.phone = EXCLUDED.phone
      AND crm_inquiries.interest = EXCLUDED.interest
      AND crm_inquiries.message = EXCLUDED.message
    RETURNING id`, [inquiry.id, inquiry.fullName, inquiry.email, inquiry.phone, inquiry.interest, inquiry.message]);
    return result.rows.length === 1;
  } catch (error) {
    const failure = error as { code?: string; status?: number };
    console.error('Inquiry storage failed', {
      code: /^[A-Z0-9_]{1,40}$/.test(failure.code || '') ? failure.code : 'UNEXPECTED',
      status: Number.isInteger(failure.status) ? failure.status : 500,
    });
    throw error;
  }
});

export const config: Config = {
  rateLimit: { action: 'rate_limit', windowSize: 60, windowLimit: 20, aggregateBy: ['ip', 'domain'] },
};
