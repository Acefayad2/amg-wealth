import { allowedKeys, assessmentSchemas, buildReport, hash, schema, scoreAttempt } from './learning-core.mjs';

const responseHeaders = { 'cache-control': 'private, no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: responseHeaders });
const iso = value => value === null || value === undefined ? null : new Date(value).toISOString();
const percentage = (part, total) => total ? Math.round(part / total * 10000) / 100 : 0;
export const reportableLearner = value => Boolean(value && typeof value.email === 'string' && !value.email.toLowerCase().endsWith('@example.invalid'));

export function buildAdminLearningSnapshot(user, records, observedAt = Date.now()) {
  const report = buildReport(user, records);
  const attempts = [];
  for (const [key, assessment] of assessmentSchemas) {
    for (const attempt of records[key]?.value?.attempts || []) {
      const form = assessment.bank.formFor(attempt);
      if (!form) continue;
      const answered = attempt.answers.filter(answer => answer !== null).length;
      const submitted = attempt.submittedAt !== null;
      attempts.push({
        attemptId: attempt.id, formId: attempt.form, title: form.title,
        track: key === schema.assessmentKey ? 'life' : 'health', kind: form.id === 'D' ? 'diagnostic' : 'mock',
        status: submitted ? 'completed' : 'in_progress',
        startedAt: iso(attempt.startedAt), submittedAt: iso(attempt.submittedAt),
        answered, total: form.questions.length, progressPercent: percentage(answered, form.questions.length),
        scorePercent: submitted ? scoreAttempt(attempt, assessment).percentage : null,
      });
    }
  }
  attempts.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const lastActiveAt = report.summary.lastActiveAt || new Date(observedAt).toISOString();
  const course = (id, title, lessons) => ({
    id, title, completedLessons: lessons.filter(lesson => lesson.complete).length,
    totalLessons: lessons.length,
    lessons: lessons.map(lesson => ({ lessonId: lesson.lessonId, title: lesson.title, complete: lesson.complete, lastActiveAt: lesson.lastActiveAt })),
  });
  return {
    learnerId: hash(user.id),
    name: user.name || '',
    email: user.email,
    lastActiveAt,
    completedLessons: report.summary.completedLessons,
    totalLessons: report.summary.totalLessons,
    courseProgressPercent: report.summary.progressPercent || 0,
    currentLesson: report.summary.currentLesson,
    courses: [course('life', 'Life insurance', report.lessons), ...Object.entries(report.tracks).map(([id, track]) => course(id, id === 'health' ? 'Accident & health' : id, track.lessons))],
    attempts,
  };
}

// Read existing saved records too, so older learners do not have to sign in again
// before the coordinator can see their Health coursework.
export async function refreshAdminLearningSnapshot(store, learner) {
  if (!/^[a-f0-9]{64}$/.test(learner.learnerId || '')) return learner;
  const prefix = `users/${learner.learnerId}/records/`;
  const { blobs } = await store.list({ prefix });
  const keys = blobs.map(blob => blob.key.slice(prefix.length)).filter(key => allowedKeys.includes(key));
  const records = {};
  for (let start = 0; start < keys.length; start += 20) {
    await Promise.all(keys.slice(start, start + 20).map(async key => {
      const record = await store.get(prefix + key, { type: 'json' });
      if (record) records[key] = record;
    }));
  }
  return { ...learner, ...buildAdminLearningSnapshot({ id: learner.learnerId, name: learner.name, email: learner.email }, records, Date.parse(learner.lastActiveAt) || Date.now()), learnerId: learner.learnerId };
}

export async function persistAdminLearningSnapshot(store, user, records, observedAt = Date.now()) {
  const key = 'learners/' + hash(user.id);
  for (let pass = 0; pass < 2; pass += 1) {
    const current = await store.getWithMetadata(key, { type: 'json' });
    const next = {
      ...buildAdminLearningSnapshot(user, records, observedAt),
      firstSeenAt: current?.data?.firstSeenAt || new Date(observedAt).toISOString(),
    };
    const options = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await store.setJSON(key, next, options);
    if (result.modified) return next;
  }
  throw new Error('Learner snapshot changed concurrently');
}

export function createAdminLearningHandler({ authenticate, isAdmin, list }) {
  return async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...responseHeaders, allow: 'GET' } });
    try {
      const user = await authenticate(request);
      if (!await isAdmin(user.id)) return json({ error: 'AMG admin access required.' }, 403);
      const raw = new URL(request.url).searchParams.get('page') || '1';
      const page = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000) return json({ error: 'Page is invalid.' }, 400);
      const result = await list(page, 25);
      return json({ ...result, page, page_size: 25 });
    } catch (error) {
      if (error?.status === 401) return json({ error: 'Sign in required.' }, 401);
      return json({ error: 'Licensing progress could not be loaded. Please try again.' }, 503);
    }
  };
}
