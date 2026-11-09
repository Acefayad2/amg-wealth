import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminLearningSnapshot, createAdminLearningHandler, persistAdminLearningSnapshot } from '../netlify/functions/_shared/admin-learning.mjs';
import { schema } from '../netlify/functions/_shared/learning-core.mjs';

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
