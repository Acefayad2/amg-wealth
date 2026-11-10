import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminLearningSnapshot, createAdminLearningHandler, persistAdminLearningSnapshot, refreshAdminLearningSnapshot } from '../netlify/functions/_shared/admin-learning.mjs';
import { learnerProgressCard } from '../admin/licensing-learning.mjs';
import { schema } from '../netlify/functions/_shared/learning-core.mjs';
import fs from 'node:fs';

const NOW = Date.parse('2026-11-09T18:42:00Z');
const USER = { id: 'learner-001', name: 'Jordan Sample', email: 'jordan@example.test' };
const form = schema.forms[1];
const attempt = {
  id: 'attempt-in-progress', form: form.id, startedAt: NOW - 600000,
  deadline: form.minutes ? NOW - 600000 + form.minutes * 60000 : null,
  submittedAt: null, expired: false, fresh: true,
  answers: form.questions.map((_question, index) => index < 37 ? 0 : null),
  flags: form.questions.map(() => false), uncertain: form.questions.map(() => false), reviewed: form.questions.map(() => false), current: 36,
};
const records = { [schema.assessmentKey]: { value: { version: schema.assessmentVersion, attempts: [attempt], seen: [form.id], reviews: {}, lessonImports: {} }, updatedAt: new Date(NOW).toISOString() } };

class MemoryStore {
  data = new Map(); counter = 0;
  async getWithMetadata(key) { return this.data.get(key) || null; }
  async setJSON(key, data, options) {
    const old = this.data.get(key);
    if (options.onlyIfNew && old || options.onlyIfMatch && options.onlyIfMatch !== old?.etag) return { modified: false };
    const value = { data: structuredClone(data), etag: `etag-${++this.counter}` };
    this.data.set(key, value); return { modified: true, etag: value.etag };
  }
}

test('licensing snapshot keeps unfinished exam attempts and their saved progress', () => {
  const snapshot = buildAdminLearningSnapshot(USER, records, NOW);
  assert.equal(snapshot.name, USER.name);
  assert.equal(snapshot.email, USER.email);
  assert.equal(snapshot.attempts.length, 1);
  assert.equal(snapshot.attempts[0].status, 'in_progress');
  assert.equal(snapshot.attempts[0].answered, 37);
  assert.equal(snapshot.attempts[0].total, form.questions.length);
  assert.equal(snapshot.attempts[0].scorePercent, null);
});

test('learner snapshots use private hashed keys and preserve first-seen time', async () => {
  const store = new MemoryStore();
  const first = await persistAdminLearningSnapshot(store, USER, records, NOW);
  const later = await persistAdminLearningSnapshot(store, USER, records, NOW + 60000);
  const [key] = store.data.keys();
  assert.match(key, /^learners\/[0-9a-f]{64}$/);
  assert(!key.includes(USER.id));
  assert.equal(later.firstSeenAt, first.firstSeenAt);
});

test('admin licensing endpoint is admin-only and returns paginated learners', async () => {
  const handler = createAdminLearningHandler({
    authenticate: async () => ({ id: 'admin-1' }),
    isAdmin: async id => id === 'admin-1',
    list: async (page, pageSize) => ({ learners: [{ name: USER.name }], total: 1, requested: [page, pageSize] }),
  });
  const response = await handler(new Request('https://amg.example.test/.netlify/functions/admin-learning?page=1'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.learners[0].name, USER.name);
  assert.equal(payload.page_size, 25);
  const denied = createAdminLearningHandler({ authenticate: async () => ({ id: 'other' }), isAdmin: async () => false, list: async () => assert.fail() });
  assert.equal((await denied(new Request('https://amg.example.test/.netlify/functions/admin-learning'))).status, 403);
});

test('admin preview contains no sample learner placeholders', () => {
  const source = fs.readFileSync(new URL('../src/admin.mjs', import.meta.url), 'utf8');
  const licensingPreview = source.slice(source.indexOf('previewMode === "licensing"'), source.indexOf('showAdminView("licensing")'));
  assert(!licensingPreview.includes('Jordan Sample'));
  assert(!licensingPreview.includes('Taylor Agent'));
  assert(!licensingPreview.includes('learnerId'));
});

test('Licensing includes unfinished and completed Health mocks alongside Life attempts', () => {
  const health = schema.tracks.health, form = health.forms[0];
  const start = { id:'health-partial',form:form.id,startedAt:NOW-40000,submittedAt:null,answers:form.questions.map((q,i)=>i<4?q.answer:null) };
  const finish = { ...start,id:'health-finished',startedAt:NOW-90000,submittedAt:NOW-50000,answers:form.questions.map(q=>q.scored?q.answer:null) };
  const combined = {...records,[health.assessmentKey]:{updatedAt:new Date(NOW).toISOString(),value:{attempts:[finish,start]}}};
  const snapshot = buildAdminLearningSnapshot(USER,combined,NOW);
  const active = snapshot.attempts.find(a=>a.attemptId===start.id);
  assert.equal(active.title,'Health Mock Exam A');
  assert.equal(active.status,'in_progress'); assert.equal(active.answered,4); assert.equal(active.total,90); assert.equal(active.scorePercent,null);
  assert.equal(snapshot.attempts.find(a=>a.attemptId===finish.id).scorePercent,100);
  assert.equal(snapshot.attempts.length,3);
});

test('saved Life and Health coursework stay separate, including for older learner snapshots', async () => {
  const healthLesson = schema.tracks.health.lessons[0];
  const lifeLesson = schema.lessons[0];
  const completed = lesson => ({ updatedAt:new Date(NOW).toISOString(), value:{ videoEnded:true, complete:true, answers:lesson.questions.map(q=>q.answer), firstAnswers:lesson.questions.map(q=>q.answer) } });
  const saved = { ...records, [healthLesson.key]:completed(healthLesson), [lifeLesson.key]:completed(lifeLesson) };
  const old = buildAdminLearningSnapshot(USER, records, NOW);
  delete old.courses;
  const prefix = `users/${old.learnerId}/records/`;
  const store = { list:async ({prefix:requested}) => { assert.equal(requested,prefix); return {blobs:Object.keys(saved).map(key=>({key:prefix+key}))}; }, get:async key=>saved[key.slice(prefix.length)] };
  const refreshed = await refreshAdminLearningSnapshot(store,old);
  assert.equal(refreshed.learnerId,old.learnerId);
  assert.equal(refreshed.courses.find(c=>c.id==='life').completedLessons,1);
  assert.equal(refreshed.courses.find(c=>c.id==='health').completedLessons,1);
  assert.equal(refreshed.courses.find(c=>c.id==='health').totalLessons,schema.tracks.health.lessons.length);
  assert.equal(refreshed.attempts[0].answered,37);
});

test('coordinator cards distinguish unfinished work from exam scores and escape learner content', () => {
  const snapshot = buildAdminLearningSnapshot({ ...USER,name:'<script>unsafe</script>' },records,NOW);
  const health = schema.tracks.health, healthForm=health.forms[0];
  snapshot.attempts.push({attemptId:'h',track:'health',kind:'mock',title:healthForm.title,status:'completed',answered:90,total:90,scorePercent:80,submittedAt:new Date(NOW).toISOString()});
  const html = learnerProgressCard(snapshot);
  assert(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert(!html.includes('<script>'));
  assert(html.includes('37 of '));
  assert(html.includes('In progress'));
  assert(html.includes('Score 80%'));
  assert(!html.includes('Score 0%'));
  assert(html.includes('Life insurance'));
  assert(html.includes('Accident &amp; health'));
});
