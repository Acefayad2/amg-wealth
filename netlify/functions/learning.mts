import type { Config } from '@netlify/functions';
import { getCourseUser } from '../shared/course-user.ts';
import { readAccessCookie, SESSION_COOKIE } from '../shared/access-session.ts';
import { getStore } from '@netlify/blobs';
import { createLearningHandler } from './_shared/learning-service.mjs';
import { persistAdminLearningSnapshot } from './_shared/admin-learning.mjs';
import { withLearningIdentity } from './_shared/learning-deletion.mjs';

export default async function learning(request: Request) {
  try {
    const baseUser = await getCourseUser(request);
    if (!baseUser) return new Response(JSON.stringify({ error: 'authentication_required' }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
    const store = getStore({ name: 'amg-learning-v1', consistency: 'strong' });
    return await withLearningIdentity(store, baseUser, user => createLearningHandler({
      getUser: async () => user,
      getStore: () => store,
      saveAdminSnapshot: async (target, profile, records) => {
        if (user.resetGeneration && !Object.keys(records).length) return;
        await persistAdminLearningSnapshot(target, profile, records);
      },
      reportingTarget: 'dashboard',
      getToken: request => readAccessCookie(request, SESSION_COOKIE),
    })(request));
  } catch {
    return new Response(JSON.stringify({ error: 'progress_service_unavailable' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
  }
}

export const config: Config = { path: '/api/learning', method: ['GET', 'POST'] };
