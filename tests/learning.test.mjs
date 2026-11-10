import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { allowedKeys, buildReport, hash, schema, scoreAttempt, userPrefix, validateValue } from '../netlify/functions/_shared/learning-core.mjs';
import { createLearningHandler, MAX_BODY_BYTES, REPORT_INTERVAL_MS } from '../netlify/functions/_shared/learning-service.mjs';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const USER = { id: 'session-user-001', email: 'agent@example.test', name: 'AMG Agent', accessGranted: true };
const ENDPOINT = 'https://amg.example.test/api/learning';
const SCRIPT = 'https://script.google.com/macros/s/test-deployment/exec';
const clone = value => structuredClone(value);

class MemoryStore {
  data = new Map(); counter = 0; writes = [];
  async getWithMetadata(key) { return this.data.has(key) ? clone(this.data.get(key)) : null; }
  async setJSON(key, data, options) {
    assert(options.onlyIfNew === true || typeof options.onlyIfMatch === 'string', 'every write must be conditional');
    const old = this.data.get(key);
    if (options.onlyIfNew && old || options.onlyIfMatch && options.onlyIfMatch !== old?.etag) return { modified: false };
    const etag = 'etag-' + ++this.counter;
    this.data.set(key, { data: clone(data), etag, metadata: {} }); this.writes.push({ key, options });
    return { modified: true, etag };
  }
}

function setup(overrides = {}) {
  const store = overrides.store || new MemoryStore(), calls = [], probes = [];
  let clock = NOW;
  const handler = createLearningHandler({ getUser: async () => USER, getStore: () => store, now: () => clock, appsScriptURL: () => '', ...overrides, fetchImpl: async (...args) => {
    if (args[1].method === 'GET') { probes.push(args); return overrides.probeImpl ? overrides.probeImpl(...args) : new Response(JSON.stringify({ ok: true, service: 'AMG Learning reporting', version: 2 })); }
    calls.push(args);
    return overrides.fetchImpl ? overrides.fetchImpl(...args) : new Response(JSON.stringify({ ok: true, syncedAt: new Date(clock).toISOString() }));
  } });
  return { handler, store, calls, probes, advance: ms => { clock += ms; } };
}

function request(body, options = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: new URL(ENDPOINT).origin, 'X-AMG-User': USER.id, Cookie: '__Host-amg_session=test-token', ...options.headers };
  return new Request(ENDPOINT + (options.query || ''), { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: options.raw || JSON.stringify(body) }) });
}
function lessonValue(lesson = schema.lessons[0], complete = false) {
  const n = lesson.questions.length;
  return { practiceAttemptId: 'practice-001', answers: complete ? lesson.questions.map(q => q.answer) : Array(n).fill(null), firstAnswers: complete ? lesson.questions.map(q => q.answer) : Array(n).fill(null), firstAnswerAt: Array(n).fill(complete ? new Date(NOW - 1000).toISOString() : null), attempts: Array(n).fill(complete ? 1 : 0), videoEnded: complete, transcriptRead: false, complete, position: 0, completedAt: complete ? new Date(NOW).toISOString() : null };
}
function attempt(form = schema.forms[0], submitted = false, id = 'attempt-001') {
  return { id, form: form.id, startedAt: NOW - 600000, deadline: form.minutes ? NOW - 600000 + form.minutes * 60000 : null, submittedAt: submitted ? NOW : null, expired: false, fresh: true, answers: form.questions.map(q => submitted ? q.answer : null), flags: form.questions.map(() => false), uncertain: form.questions.map(() => false), reviewed: form.questions.map(() => false), current: 0 };
}
function assessmentValue(attempts = []) { return { version: schema.assessmentVersion, attempts, seen: [...new Set(attempts.map(a => a.form))], reviews: {}, lessonImports: {} }; }
const envelope = (value = lessonValue(), revision = 0, mutationId = 'mutation-0001', key = schema.lessons[0].key) => ({ key, value, revision, mutationId });
async function send(system, body, options) { const response = await system.handler(request(body, options)); return { response, data: await response.json() }; }

test('server answer schema binds all61 exact current source files and all814 questions', () => {
  assert.equal(schema.lessons.length, 60); assert.equal(allowedKeys.length, 122); assert.equal(allowedKeys.filter(key => key.startsWith('amg-life-')).length, 61);
  assert.equal(schema.lessons.flatMap(l => l.questions).length, 512);
  assert.equal(schema.forms.flatMap(f => f.questions).length, 302);
  for (const [path, expected] of Object.entries(schema.sourceHashes)) assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../' + path.replace(/^public\//, ''), import.meta.url))).digest('hex'), expected, path);
  for (const lesson of schema.lessons) {
    const window = {}; vm.runInNewContext(fs.readFileSync(new URL('../course/lesson-' + lesson.id + '/lesson-data.js', import.meta.url), 'utf8'), { window });
    const data = Object.values(window)[0];
    assert.equal(lesson.version, data.version);
    data.questions.forEach((q, i) => { assert.equal(q.answer, lesson.questions[i].answer); assert.equal(q.options.length, lesson.questions[i].options); });
  }
});

test('signed-session authorization is required before any store operation', async () => {
  for (const [user, status, error] of [[null, 401, 'authentication_required'], [{ ...USER, accessGranted: undefined }, 403, 'course_access_required'], [{ ...USER, email: '' }, 403, 'course_access_required'], [{ ...USER, accessGranted: false, confirmedAt: '2026-09-12T12:00:00Z', roles: ['amg-agent'] }, 403, 'course_access_required']]) {
    const s = setup({ getUser: async () => user, getStore: () => { assert.fail('unauthorized store access'); } });
    for (const body of [undefined, envelope()]) { const result = await send(s, body); assert.equal(result.response.status, status); assert.equal(result.data.error, error); }
  }
});

test('cross-account assertions and cross-origin writes are rejected', async () => {
  const s = setup();
  for (const headers of [{ 'X-AMG-User': 'other-user' }, { 'X-AMG-User': '' }, { Origin: 'https://attacker.test' }, { Origin: '' }]) {
    assert.equal((await send(s, envelope(), { headers })).response.status, 403);
    assert.equal((await send(s, { action: 'sync-report' }, { headers })).response.status, 403);
  }
  assert.equal(s.store.writes.length, 0);
});

test('GET has private no-store headers and absent records; paths contain no raw identity data', async () => {
  const s = setup(); const { data, response } = await send(s);
  assert.deepEqual(data.records, {}); assert.equal(data.user.id, USER.id);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(data.reporting.status, 'not_configured');
  await send(s, envelope());
  assert(s.store.writes.every(write => !write.key.includes(USER.email) && !write.key.includes(USER.id)));
  assert.notEqual(userPrefix(USER.id), userPrefix('another-user'));
});

test('every learner visit and unfinished assessment save refreshes the private admin snapshot', async () => {
  const snapshots = [];
  const s = setup({ saveAdminSnapshot: async (_store, user, savedRecords) => snapshots.push({ user, records: clone(savedRecords) }) });
  await send(s);
  const partial = attempt(schema.forms[1], false, 'unfinished-001');
  partial.answers[0] = 0;
  await send(s, envelope(assessmentValue([partial]), 0, 'mutation-partial-001', schema.assessmentKey));
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].user.email, USER.email);
  assert.equal(snapshots[1].records[schema.assessmentKey].value.attempts[0].submittedAt, null);
  assert.equal(snapshots[1].records[schema.assessmentKey].value.attempts[0].answers[0], 0);
});

test('live dashboard reporting uses saved course records without contacting the old spreadsheet', async () => {
  const s = setup({ reportingTarget:'dashboard', appsScriptURL:()=>SCRIPT, saveAdminSnapshot:async()=>{} });
  assert.equal((await send(s)).data.reporting.status,'live');
  const saved = await send(s,envelope());
  assert.equal(saved.data.record.revision,1);
  assert.equal(saved.data.reporting.target,'dashboard');
  assert.equal(saved.data.reporting.status,'live');
  assert.equal(s.calls.length,0);
  assert.equal(s.probes.length,0);
});

test('a temporary coordinator index failure keeps progress saved and automatically retryable', async () => {
  let failing=true;
  const s=setup({ reportingTarget:'dashboard', saveAdminSnapshot:async()=>{if(failing)throw Error('temporary');} });
  const saved=await send(s,envelope());
  assert.equal(saved.response.status,200);
  assert.equal(saved.data.record.revision,1);
  assert.equal(saved.data.reporting.status,'pending');
  assert.equal(saved.data.reporting.target,'dashboard');
  failing=false;
  assert.equal((await send(s,{action:'sync-report'})).data.reporting.status,'live');
  assert.equal(s.calls.length,0);
});

test('every current lesson state and all four assessment forms validate', () => {
  for (const lesson of schema.lessons) {
    assert.deepEqual(validateValue(lesson.key, lessonValue(lesson), NOW), lessonValue(lesson));
    validateValue(lesson.key, lessonValue(lesson, true), NOW);
  }
  validateValue(schema.assessmentKey, assessmentValue(schema.forms.map((form, i) => attempt(form, true, 'attempt-' + i))), NOW);
});

test('unknown envelope/keys/version, unsafe revision, mutation IDs, and claimed identity are rejected', async () => {
  const cases = [
    { ...envelope(), uid: USER.id }, { ...envelope(), key: '__proto__' }, { ...envelope(), key: 'amg-life-lesson-01-v1' },
    { ...envelope(), revision: -1 }, { ...envelope(), revision: Number.MAX_SAFE_INTEGER + 1 }, { ...envelope(), mutationId: '../path' },
    envelope({ ...assessmentValue(), version: 2 }, 0, 'mutation-001', schema.assessmentKey),
  ];
  for (const body of cases) { const s = setup(); assert.equal((await send(s, body)).response.status, 400); assert.equal(s.store.writes.length, 0); }
});

test('JSON parsing, content type and both announced/streamed body limits are enforced', async () => {
  const s = setup();
  assert.equal((await send(s, {}, { raw: '{' })).response.status, 400);
  assert.equal((await send(s, {}, { raw: 'null' })).response.status, 400);
  assert.equal((await send(s, envelope(), { headers: { 'Content-Type': 'text/plain' } })).response.status, 415);
  assert.equal((await send(s, envelope(), { headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } })).response.status, 413);
  assert.equal((await send(s, {}, { raw: JSON.stringify({ text: 'x'.repeat(MAX_BODY_BYTES) }) })).response.status, 413);
  assert.equal(s.store.writes.length, 0);
});

test('invalid answer indices, array lengths, timestamps, positions and completion evidence are rejected', async () => {
  const changes = [v => v.answers[0] = 4, v => v.firstAnswers[0] = -1, v => v.answers.pop(), v => v.attempts[0] = 1.2, v => v.firstAnswerAt[0] = 'tomorrow', v => v.position = 100000, v => v.position = -1, v => v.complete = true, v => { v.answers[0] = 0; }, v => { v.unexpected = true; }];
  for (const change of changes) { const s = setup(), value = lessonValue(); change(value); assert.equal((await send(s, envelope(value))).response.status, 400); assert.equal(s.store.writes.length, 0); }
  const value = lessonValue(schema.lessons[0], true); value.answers[0] = (value.answers[0] + 1) % 4;
  assert.equal((await send(setup(), envelope(value))).response.status, 400);
});

test('transcript path can finish, and all-correct answers alone do not imply Finish was clicked', () => {
  const lesson = schema.lessons[0], value = lessonValue(lesson, true);
  value.videoEnded = false; value.transcriptRead = true; validateValue(lesson.key, value, NOW);
  value.complete = false; value.completedAt = null;
  const report = buildReport(USER, { [lesson.key]: { value, updatedAt: new Date(NOW).toISOString() } });
  assert.equal(report.summary.completedLessons, 0); assert.equal(report.lessons[0].correct, 8);
});

test('conditional create and update use exact current SDK options and monotonic revisions', async () => {
  const s = setup(); let result = await send(s, envelope());
  assert.equal(result.data.record.revision, 1);
  assert.deepEqual(s.store.writes[0].options, { onlyIfNew: true });
  const value = lessonValue(); value.position = 10;
  result = await send(s, envelope(value, 1, 'mutation-0002'));
  assert.equal(result.data.record.revision, 2); assert.equal(s.store.writes[1].options.onlyIfMatch, 'etag-1');
  assert.deepEqual(result.data.record.value, value);
});

test('stale revision returns current record409 and cannot overwrite saved progress', async () => {
  const s = setup(); await send(s, envelope());
  const changed = lessonValue(); changed.position = 25;
  const result = await send(s, envelope(changed, 0, 'mutation-0002'));
  assert.equal(result.response.status, 409); assert.equal(result.data.error, 'conflict');
  assert.equal(result.data.record.revision, 1); assert.equal(result.data.record.value.position, 0); assert.equal(s.store.writes.length, 1);
});

test('simultaneous competing creations yield one accepted write and one conflict', async () => {
  const s = setup(), value = lessonValue(); value.position = 2;
  const results = await Promise.all([send(s, envelope()), send(s, envelope(value, 0, 'mutation-0002'))]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [200, 409]); assert.equal(s.store.writes.length, 1);
});

test('idempotent retries include concurrent identical requests and cannot reuse ID for another payload', async () => {
  const s = setup();
  const results = await Promise.all([send(s, envelope()), send(s, envelope())]);
  assert(results.every(result => result.response.status === 200)); assert.equal(s.store.writes.length, 1);
  assert.equal((await send(s, envelope())).data.idempotent, true);
  const value = lessonValue(); value.position = 22;
  assert.equal((await send(s, envelope(value))).response.status, 409);
  await send(s, envelope(value, 1, 'mutation-0002'));
  const retry = await send(s, envelope()); assert.equal(retry.data.record.revision, 2); assert.equal(retry.data.record.value.position, 22);
});

test('bounded idempotency history cannot allow an evicted ancient retry to overwrite current state', async () => {
  const s = setup();
  for (let i = 0; i < 66; i++) { const value = lessonValue(); value.position = i; assert.equal((await send(s, envelope(value, i, 'mutation-' + String(i).padStart(4, '0')))).response.status, 200); }
  const record = [...s.store.data.values()][0].data;
  assert.equal(record.mutations.length, 64); assert.equal(record.revision, 66);
  assert.equal((await send(s, envelope(lessonValue(), 0, 'mutation-0000'))).response.status, 409);
});

test('invalid deadlines, duplicate attempt IDs and submitted result changes are rejected', async () => {
  const form = schema.forms[1], initial = attempt(form, true), s = setup();
  const value = assessmentValue([initial]);
  assert.equal((await send(s, envelope(value, 0, 'mutation-0001', schema.assessmentKey))).response.status, 200);
  for (const change of [v => v.attempts[0].answers[0] = (initial.answers[0] + 1) % 4, v => v.attempts[0].deadline += 1, v => v.attempts[0].submittedAt = null, v => v.attempts = [], v => v.attempts.push(clone(v.attempts[0]))]) {
    const next = clone(value); change(next); assert.equal((await send(s, envelope(next, 1, 'mutation-0002', schema.assessmentKey))).response.status, 400);
  }
  const reviewed = clone(value); reviewed.attempts[0].reviewed[0] = true;
  assert.equal((await send(s, envelope(reviewed, 1, 'mutation-0003', schema.assessmentKey))).response.status, 200);
});

test('review queue and lesson import shapes preserve genuine recurring-review fields but reject arbitrary IDs', () => {
  const value = assessmentValue();
  value.reviews['L01-01'] = { stage: 1, nextDue: NOW + 3 * 86400000, history: [{ questionId: schema.forms[0].questions[0].id, at: NOW, correct: true }], lastMissAt: NOW - 86400000, lastMissId: 'lesson-01:attempt:0' };
  value.lessonImports[schema.lessons[0].key] = JSON.stringify([[1], null, 'practice-001', [new Date(NOW).toISOString()]]);
  validateValue(schema.assessmentKey, value, NOW);
  const bad = clone(value); bad.reviews['fake-question'] = bad.reviews['L01-01']; assert.throws(() => validateValue(schema.assessmentKey, bad, NOW));
  const badImport = clone(value); badImport.lessonImports.arbitrary = 'test'; assert.throws(() => validateValue(schema.assessmentKey, badImport, NOW));
});

test('all302 item keys score correctly; each mock has80 scored+10 separately reported unscored items', () => {
  for (const form of schema.forms) {
    const a = attempt(form, true), expected = form.id === 'D' ? 32 : 80;
    assert.deepEqual(scoreAttempt(a), { correct: expected, total: expected, percentage: 100, unscoredCorrect: form.id === 'D' ? 0 : 10, unscoredTotal: form.id === 'D' ? 0 : 10 });
    form.questions.forEach((q, index) => {
      const wrong = clone(a); wrong.answers[index] = (q.answer + 1) % q.options;
      const result = scoreAttempt(wrong); assert.equal(result.correct, expected - (q.scored ? 1 : 0));
      assert.equal(result.unscoredCorrect, (form.id === 'D' ? 0 : 10) - (q.scored ? 0 : 1));
    });
  }
});

test('summaries derive all60 completions,512 mastery and real scores, with server completion dates', () => {
  const records = Object.fromEntries(schema.lessons.map(lesson => [lesson.key, { value: lessonValue(lesson, true), firstCompletedAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() }]));
  const diagnostic = attempt(schema.forms[0], true, 'diagnostic-1'); diagnostic.answers[0] = null;
  const mock = attempt(schema.forms[1], true, 'mock-1');
  const retake = attempt(schema.forms[1], true, 'mock-2'); retake.startedAt += 1000; retake.submittedAt += 1000; retake.answers[0] = null;
  records[schema.assessmentKey] = { value: assessmentValue([diagnostic, mock, retake]), updatedAt: new Date(NOW).toISOString() };
  const report = buildReport(USER, records);
  assert.equal(report.summary.completedLessons, 60); assert.equal(report.summary.progressPercent, 100); assert.equal(report.summary.questionMastery, 100);
  assert.equal(report.summary.courseCompletedAt, new Date(NOW).toISOString());
  assert.equal(report.summary.diagnosticScore, 96.88); assert.equal(report.summary.bestMockScore, 100); assert.equal(report.summary.practiceAttempts, 3);
  assert.equal(report.attempts[2].fresh, false); assert.equal(report.attempts[1].total, 80);
  assert.equal(buildReport(USER, {}).summary.courseCompletedAt, null);
});

test('report GET uses only server records and never contacts Sheets recursively', async () => {
  const s = setup({ appsScriptURL: () => SCRIPT, fetchImpl: async () => assert.fail('Report GET must not sync') });
  const result = await send(s, undefined, { query: '?report=1' });
  assert.equal(result.response.status, 200); assert.equal(result.data.summary.uid, USER.id); assert.equal(result.data.lessons.length, 60); assert.deepEqual(result.data.attempts, []);
});

test('successful sheet sync sends token+action only and requires explicit timestamped JSON acknowledgment', async () => {
  const s = setup({ appsScriptURL: () => SCRIPT });
  const result = await send(s);
  assert.equal(result.data.reporting.status, 'synced'); assert.equal(s.calls.length, 1);
  assert.equal(s.probes.length, 1); assert.equal(s.probes[0][1].method, 'GET'); assert.equal(s.probes[0][1].body, undefined);
  assert(!JSON.stringify(s.probes[0]).includes('test-token'));
  assert.deepEqual(JSON.parse(s.calls[0][1].body), { action: 'course_sync', sessionToken: 'test-token' });
  assert.equal(s.calls[0][0], SCRIPT); assert.equal(s.calls[0][1].signal instanceof AbortSignal, true);
});

test('legacy or unverified reporting endpoints never receive a POST, token or learner payload', async () => {
  for (const payload of ['<html>Script function not found: doGet</html>', { ok: true }, { ok: true, service: 'Legacy exams', version: 1 }, { ok: true, service: 'AMG Learning reporting', version: 1 }, { ok: false, service: 'AMG Learning reporting', version: 2 }, { ok: true, service: 'AMG Learning reporting', version: 2, unexpected: true }]) {
    const s = setup({ appsScriptURL: () => SCRIPT, probeImpl: async () => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload)), fetchImpl: async () => assert.fail('Unsafe POST to legacy endpoint') });
    const result = await send(s, envelope(lessonValue(schema.lessons[0], true)));
    assert.equal(result.response.status, 200); assert.equal(result.data.record.revision, 1); assert.equal(result.data.reporting.status, 'pending');
    assert.equal(s.calls.length, 0); assert.equal(s.probes.length, 1); assert(!JSON.stringify(s.probes[0]).includes('test-token'));
  }
});

test('readiness network failures and non2xx probes keep progress durable with no POST', async () => {
  for (const probeImpl of [async () => { throw new Error('network'); }, async () => new Response(JSON.stringify({ ok: true, service: 'AMG Learning reporting', version: 2 }), { status: 503 })]) {
    const s = setup({ appsScriptURL: () => SCRIPT, probeImpl });
    const result = await send(s, envelope()); assert.equal(result.response.status, 200); assert.equal(result.data.reporting.status, 'pending'); assert.equal(s.calls.length, 0);
  }
});

test('sheet failure or non-JSON/opaque acknowledgment cannot undo saved progress or claim sync', async () => {
  for (const response of ['html', JSON.stringify({ ok: false }), JSON.stringify({ ok: true }), 'error']) {
    const s = setup({ appsScriptURL: () => SCRIPT, fetchImpl: async () => { if (response === 'error') throw new Error('network'); return new Response(response); } });
    const result = await send(s, envelope(lessonValue(schema.lessons[0], true)));
    assert.equal(result.response.status, 200); assert.equal(result.data.record.revision, 1); assert.equal(result.data.reporting.status, 'pending');
    const get = await send(s, undefined, { query: '?report=1' }); assert.equal(get.data.summary.completedLessons, 1);
  }
});

test('sheet timeout leaves saved progress pending and retry endpoint recovers after coalescing interval', async () => {
  let fail = true, calls = 0;
  const s = setup({ appsScriptURL: () => SCRIPT, reportTimeoutMs: 5, fetchImpl: async (_url, options) => { calls++; if (fail) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); return new Response(JSON.stringify({ ok: true, syncedAt: new Date(NOW).toISOString() })); } });
  assert.equal((await send(s, envelope(lessonValue(schema.lessons[0], true)))).data.reporting.status, 'pending');
  fail = false;
  assert.equal((await send(s, { action: 'sync-report' })).data.reporting.status, 'pending'); assert.equal(calls, 1);
  s.advance(REPORT_INTERVAL_MS + 1);
  assert.equal((await send(s, { action: 'sync-report' })).data.reporting.status, 'synced'); assert.equal(calls, 2);
});

test('lesson start and finish report; position/answer and in-progress assessment saves wait for coalesced retry', async () => {
  const s = setup({ appsScriptURL: () => SCRIPT });
  let value = lessonValue(); value.position = 50;
  await send(s, envelope(value)); assert.equal(s.calls.length, 1);
  value.position = 60; await send(s, envelope(value, 1, 'mutation-0002')); assert.equal(s.calls.length, 1);
  await send(s, envelope(assessmentValue([attempt()]), 0, 'assessment-0001', schema.assessmentKey)); assert.equal(s.calls.length, 1);
  s.advance(30001);
  await send(s, envelope(lessonValue(schema.lessons[0], true), 2, 'mutation-0003')); assert.equal(s.calls.length, 2);
  const another = schema.lessons[1]; const pending = await send(s, envelope(lessonValue(another, true), 0, 'another-0001', another.key)); assert.equal(pending.data.reporting.status, 'pending'); assert.equal(s.calls.length, 2);
  s.advance(REPORT_INTERVAL_MS + 1); await send(s, { action: 'sync-report' }); assert.equal(s.calls.length, 3);
});

test('an older Sheets acknowledgment cannot claim sync after a concurrent newer progress write', async () => {
  let s;
  s = setup({ appsScriptURL: () => SCRIPT, fetchImpl: async () => {
    const value = lessonValue(); value.position = 50;
    const result = await send(s, envelope(value, 1, 'mutation-0002'));
    assert.equal(result.response.status, 200);
    return new Response(JSON.stringify({ ok: true, syncedAt: new Date(NOW).toISOString() }));
  } });
  const result = await send(s, envelope());
  assert.equal(result.response.status, 200); assert.equal(result.data.reporting.status, 'pending');
});

test('fixed AppsScript destination cannot be replaced by a request body or non-Google environment URL', async () => {
  const s = setup({ appsScriptURL: () => 'https://attacker.test/exec' });
  assert.equal((await send(s)).data.reporting.status, 'not_configured'); assert.equal(s.calls.length, 0);
  assert.equal((await send(s, { action: 'sync-report', url: SCRIPT })).response.status, 400);
});

test('simultaneous report triggers use a conditional lease, not duplicate spreadsheet writes', async () => {
  const s = setup({ appsScriptURL: () => SCRIPT });
  const results = await Promise.all([send(s), send(s)]);
  assert(results.every(result => result.response.status === 200)); assert.equal(s.calls.length, 1);
  assert.equal(s.store.writes.filter(write => write.key.endsWith('/reporting') && write.options.onlyIfNew).length, 1);
});

test('storage failures are explicit503 and never disclose provider details or credentials', async () => {
  const s = setup({ getStore: () => { throw new Error('secret-provider-detail'); } });
  const result = await send(s, envelope()); assert.equal(result.response.status, 503); assert.deepEqual(result.data, { error: 'progress_service_unavailable' });
});

test('production adapter uses signed sessions, strong storage and direct dashboard reporting', () => {
  const source = fs.readFileSync(new URL('../netlify/functions/learning.mts', import.meta.url), 'utf8');
  assert.match(source, /import \{ getCourseUser \} from '\.\.\/shared\/course-user\.ts'/);
  assert.match(source, /getUser: getCourseUser/);
  assert.match(source, /consistency: 'strong'/); assert.match(source, /reportingTarget: 'dashboard'/);
  assert(!source.includes('AMG_APPS_SCRIPT_URL'));
  assert(!source.includes('process.env'));
  assert.match(source, /readAccessCookie\(request, SESSION_COOKIE\)/);
  assert.match(source, /saveAdminSnapshot: persistAdminLearningSnapshot/);
  assert(!source.includes('@netlify/identity'));
  assert(!source.includes('nf_jwt'));
  assert(!source.includes('VITE_APPS_SCRIPT_URL'), 'Legacy build-time endpoint must never become a reporting destination');
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
});

test('health track binds 60 lessons, 484 answers and exact current source files', () => {
  const health = schema.tracks.health;
  assert.equal(health.lessons.length, 60); assert.deepEqual(health.forms.map(f => f.id), ['A', 'B', 'C']);
  assert.equal(health.lessons.flatMap(lesson => lesson.questions).length, 484);
  assert.equal(Object.keys(health.sourceHashes).length, 61);
  assert(allowedKeys.includes(health.assessmentKey), 'the Health assessment key is enabled for these forms');
  for (const [sourcePath, expected] of Object.entries(health.sourceHashes)) {
    const localPath = sourcePath.replace(/^public\//, '');
    assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../' + localPath, import.meta.url))).digest('hex'), expected, sourcePath);
  }
  const ids = new Set();
  for (const lesson of health.lessons) {
    assert.equal(lesson.key, 'amg-health-lesson-' + lesson.id + '-v' + lesson.version); assert(allowedKeys.includes(lesson.key));
    const window = {}; vm.runInNewContext(fs.readFileSync(new URL('../course/health/lesson-' + lesson.id + '/lesson-data.js', import.meta.url), 'utf8'), { window });
    const data = Object.values(window)[0];
    assert.equal(data.key, lesson.key); assert.equal(data.version, lesson.version);
    assert.equal(lesson.maxPosition, data.duration ? Math.ceil(data.duration) + 2 : 0);
    assert.equal(data.pending, !data.video, 'a lesson without video must publish as a text edition');
    data.questions.forEach((question, index) => {
      assert.match(question.id, /^H\d{2}-\d{2}$/); assert(!ids.has(question.id), question.id); ids.add(question.id);
      assert.equal(question.id, lesson.questions[index].id); assert.equal(question.answer, lesson.questions[index].answer); assert.equal(question.options.length, lesson.questions[index].options);
    });
  }
  const lifeIds = new Set(schema.lessons.flatMap(lesson => lesson.questions.map(question => question.id)));
  assert.equal([...ids].filter(id => lifeIds.has(id)).length, 0, 'Health question ids never collide with Life ids');
});

test('health lessons validate video progress and report per track without touching Life totals', async () => {
  const health = schema.tracks.health, lesson = health.lessons[0];
  for (const item of health.lessons) {
    assert.deepEqual(validateValue(item.key, lessonValue(item), NOW), lessonValue(item));
    const done = lessonValue(item, true); done.videoEnded = false; done.transcriptRead = true; validateValue(item.key, done, NOW);
  }
  const playing = lessonValue(lesson); playing.position = 5;
  assert.deepEqual(validateValue(lesson.key, playing, NOW), playing, 'a video lesson saves playback position');
  const pastEnd = {...playing, position: lesson.maxPosition + 1};
  assert.throws(() => validateValue(lesson.key, pastEnd, NOW), /position/i);
  const system = setup(), value = lessonValue(lesson, true); value.videoEnded = false; value.transcriptRead = true;
  const saved = await send(system, envelope(value, 0, 'mutation-h001', lesson.key));
  assert.equal(saved.response.status, 200); assert.equal(saved.data.record.revision, 1);
  const loaded = await send(system, undefined);
  assert.deepEqual(loaded.data.records[lesson.key].value, value);
  const report = (await send(system, undefined, { query: '?report=1' })).data;
  assert.equal(report.tracks.health.completedLessons, 1); assert.equal(report.tracks.health.totalLessons, 60);
  assert.equal(report.tracks.health.lessons[0].correct, lesson.questions.length);
  assert.equal(report.summary.completedLessons, 0); assert.equal(report.summary.totalLessons, 60); assert.equal(report.lessons.length, 60);
  assert.equal((await send(system, envelope(value, 0, 'mutation-h002', 'amg-health-lesson-61-v1'))).response.status, 400);
  assert.equal((await send(system, envelope({ version: 1, attempts: [], seen: [], reviews: {}, lessonImports: {} }, 0, 'mutation-h003', health.assessmentKey))).response.status, 200);
});

test('Health mocks resume and score against their own key, including when Life uses the same form letter', async () => {
  const health = schema.tracks.health, form = health.forms[1], service = setup();
  const started = attempt(form, false, 'health-exam-002');
  started.answers[0] = form.questions[0].answer;
  const save = await send(service, envelope(assessmentValue([started]), 0, 'mutation-mock-01', health.assessmentKey));
  assert.equal(save.response.status, 200);
  const resume = (await send(service, undefined)).data.records[health.assessmentKey].value.attempts[0];
  assert.deepEqual(resume, started);
  const finished = { ...started, answers: form.questions.map(q => q.scored ? q.answer : (q.answer + 1) % q.options), submittedAt: NOW };
  assert.equal((await send(service, envelope(assessmentValue([finished]), 1, 'mutation-mock-02', health.assessmentKey))).response.status, 200);
  const report = (await send(service, undefined, {query:'?report=1'})).data;
  assert.deepEqual(report.attempts, []);
  assert.equal(report.tracks.health.attempts[0].title, 'Health Mock Exam B');
  assert.equal(report.tracks.health.attempts[0].correct, 80);
  assert.equal(report.tracks.health.attempts[0].unscoredCorrect, 0);
  assert.equal(report.tracks.health.latestMockScore, 100);
  const wrongKey = { ...assessmentValue([finished]), lessonImports:{[schema.lessons[0].key]:'a'} };
  assert.throws(() => validateValue(health.assessmentKey, wrongKey, NOW), /imported lesson/);
});
