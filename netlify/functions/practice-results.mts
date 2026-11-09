import type { Config } from '@netlify/functions';
import { getPool } from './_shared/db.mjs';
import { createPracticeSubmitHandler } from './_shared/practice-results.mjs';
export default createPracticeSubmitHandler(async (r: { id: string; name: string; email: string; examType: string; score: number; total: number; wrong: number; skipped: number; earlyFail: boolean; percentage: number; passed: boolean }) => {
  const result = await getPool().query(`INSERT INTO amg_private.practice_results
    (id, full_name, email, exam_type, score, total, wrong, skipped, early_fail, percentage, passed)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
    WHERE (practice_results.full_name,practice_results.email,practice_results.exam_type,practice_results.score,practice_results.total,practice_results.wrong,practice_results.skipped,practice_results.early_fail)
      = (EXCLUDED.full_name,EXCLUDED.email,EXCLUDED.exam_type,EXCLUDED.score,EXCLUDED.total,EXCLUDED.wrong,EXCLUDED.skipped,EXCLUDED.early_fail)
    RETURNING id`, [r.id,r.name,r.email,r.examType,r.score,r.total,r.wrong,r.skipped,r.earlyFail,r.percentage,r.passed]);
  return result.rows.length === 1;
});
export const config: Config = { path: '/api/practice-results', rateLimit: { action: 'rate_limit', windowSize: 60, windowLimit: 20, aggregateBy: ['ip','domain'] } };
