import type { Config } from '@netlify/functions';
import { getCourseUser } from '../shared/course-user.ts';
import { readAccessCookie, SESSION_COOKIE } from '../shared/access-session.ts';
import { getStore } from '@netlify/blobs';
import { createLearningHandler } from './_shared/learning-service.mjs';

export default createLearningHandler({
  getUser: getCourseUser,
  getStore: () => getStore({ name: 'amg-learning-v1', consistency: 'strong' }),
  appsScriptURL: () => Netlify.env.get('AMG_APPS_SCRIPT_URL') || '',
  getToken: request => readAccessCookie(request, SESSION_COOKIE),
});

export const config: Config = { path: '/api/learning', method: ['GET', 'POST'] };
