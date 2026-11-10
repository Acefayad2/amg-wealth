import { getStore } from '@netlify/blobs';
import { getInquiryPool } from './_shared/inquiry-db.mjs';
import { getAuthenticatedUser } from './_shared/supabase.mjs';
import { createAdminLearningHandler, refreshAdminLearningSnapshot, reportableLearner } from './_shared/admin-learning.mjs';

export default createAdminLearningHandler({
  authenticate: async request => (await getAuthenticatedUser(request)).user,
  isAdmin: async id => {
    const { rows } = await getInquiryPool().query('SELECT 1 FROM amg_private.crm_admins WHERE user_id = $1', [id]);
    return rows.length === 1;
  },
  list: async (page, pageSize) => {
    const store = getStore({ name: 'amg-learning-v1', consistency: 'strong' });
    const { blobs } = await store.list({ prefix: 'learners/' });
    const learners = [];
    for (let start = 0; start < blobs.length; start += 25) {
      const batch = await Promise.all(blobs.slice(start, start + 25).map(blob => store.get(blob.key, { type: 'json' })));
      learners.push(...batch.filter(reportableLearner));
    }
    learners.sort((a, b) => Date.parse(b.lastActiveAt || 0) - Date.parse(a.lastActiveAt || 0));
    const selected = learners.slice((page - 1) * pageSize, page * pageSize);
    const current = [];
    for (let start = 0; start < selected.length; start += 5) {
      current.push(...await Promise.all(selected.slice(start, start + 5).map(learner => refreshAdminLearningSnapshot(store, learner))));
    }
    return { learners: current, total: learners.length };
  },
});
