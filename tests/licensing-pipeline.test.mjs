import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transform } from 'esbuild';
import { licensingSteps, licensingProgress, stepDone, stepUpdates, selectedStepsForStage } from '../licensing-progress/steps.js';

test('five milestones require both license items and both CE/E&O items', () => {
  const person = { tasks: stepUpdates(['exam_booked', 'state_exam_passed'], 'admin') };
  person.tasks.license_uploaded.done = true;
  assert.equal(licensingProgress(person).current, 2);
  assert.equal(licensingProgress(person).percent, 40);
  person.tasks.license_application.done = true;
  person.tasks.ce_courses.done = true;
  assert.equal(licensingProgress(person).current, 3);
  assert.equal(stepDone(person, licensingSteps[3]), false);
  person.tasks.eo_active.done = true;
  assert.equal(licensingProgress(person).current, 4);
  person.tasks.appointed.done = true;
  assert.equal(licensingProgress(person).label, 'Licensing complete');
  assert.equal(licensingProgress(person).percent, 100);
});
test('imported exam status is honored until an explicit correction is stored', () => {
  assert.equal(licensingProgress({ exam_status: 'passed' }).completed, 2);
  assert.equal(licensingProgress({ exam_status: 'passed', tasks: { exam_booked: { done: false } } }).current, 0);
  assert.equal(licensingProgress({ tasks: { first_check: { done: true }, php_account: { done: true } } }).percent, 0);
});

let source = await fs.readFile(new URL('../netlify/functions/licensing-pipeline.mts', import.meta.url), 'utf8');
source = source.replace(/^import .*?;\n/gm, '').replace('export const config: Config', 'export const config');
const helpers = new URL('../licensing-progress/steps.js', import.meta.url).href;
source = `import { licensingSteps, stepUpdates, selectedStepsForStage } from ${JSON.stringify(helpers)};\nconst { getInquiryPool, getAuthenticatedUser, getCourseUser, normalizeUsPhone } = globalThis.__amgLicensingTest;\n` + source;
const calls = [];
let admin = true, stale = false;
globalThis.__amgLicensingTest = {
  getInquiryPool: () => ({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT 1')) return { rows: [{ exists: 1 }] };
    return { rows: stale ? [] : [{ id: '00000000-0000-4000-8000-000000000001', name: 'Edited Name' }] };
  } }),
  getAuthenticatedUser: async () => ({ user: { id: 'admin' } }),
  getCourseUser: async () => ({ name: 'Learner', email: 'learner@example.test' }),
  normalizeUsPhone: value => value.replace(/\D/g, '').length === 10 ? '+1' + value.replace(/\D/g, '') : null,
};
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const request = body => new Request('https://amg.example/api/licensing-pipeline', { method: 'POST', headers: { origin: 'https://amg.example', 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer test' } : {}) }, body: JSON.stringify(body) });
const save = { action: 'save_person', id: '00000000-0000-4000-8000-000000000001', expectedVersion: 3, name: 'Edited Name', email: 'new@example.test', phone: '(202) 555-0123', recruiter: 'New upline', state: 'Maryland', track: 'both', examStatus: 'studying', completedSteps: ['exam_booked','state_exam_passed','license_uploaded'] };
test('admin saves editable person fields and all five milestones atomically with version protection', async () => {
  admin = true; stale = false; calls.length = 0;
  assert.equal((await handler(request(save))).status, 200);
  const query = calls.at(-1);
  assert.match(query.sql, /WHERE id=\$14 AND version=\$15/);
  assert.equal(query.params[0], 'Edited Name');
  assert.equal(query.params[2], '+12025550123');
  assert.equal(query.params[7], 'passed');
  const patch = JSON.parse(query.params[12]);
  assert.equal(patch.license_application.done, true);
  assert.equal(patch.license_uploaded.done, true);
  assert.equal(patch.eo_active.done, false);
  assert.equal(query.params.at(-1), 3);
  stale = true;
  assert.equal((await handler(request(save))).status, 409);
  stale = false;
});
test('learner updates their own combined CE and E&O step and cannot confirm official milestones or edit person details', async () => {
  admin = false; calls.length = 0;
  assert.equal((await handler(request({ action: 'set_step', task: 'ce_courses', done: true, id: save.id }))).status, 200);
  const query = calls.at(-1);
  assert.match(query.sql, /WHERE lower\(email\)=\$3/);
  assert.equal(query.params[2], 'learner@example.test');
  assert.deepEqual(Object.keys(JSON.parse(query.params[0])), ['ce_courses','eo_active']);
  const writes = calls.length;
  assert.equal((await handler(request({ action: 'set_step', task: 'appointed', done: true }))).status, 403);
  assert.equal((await handler(request({ action: 'set_step', task: 'state_exam_passed', done: true }))).status, 403);
  assert.equal((await handler(request(save))).status, 400);
  assert.equal(calls.length, writes);
});
test('invalid milestones and foreign origin cannot change a person', async () => {
  admin = true;
  assert.equal((await handler(request({ ...save, completedSteps: ['not-a-step'] }))).status, 400);
  const foreign = new Request('https://amg.example/api/licensing-pipeline', { method: 'POST', headers: { origin: 'https://elsewhere.example' } });
  assert.equal((await handler(foreign)).status, 403);
});


test('slider positions complete earlier steps and reject non-discrete positions', () => {
  assert.deepEqual(selectedStepsForStage(1), []);
  assert.deepEqual(selectedStepsForStage(4), ['exam_booked', 'state_exam_passed', 'license_uploaded']);
  assert.equal(selectedStepsForStage(6).length, 5);
  for (const value of [0, 7, 2.5, '3', null]) assert.throws(() => selectedStepsForStage(value));
});
test('admin slider saves a sequential stage with optimistic version protection', async () => {
  admin = true; stale = false; calls.length = 0;
  const move = { action: 'set_stage', id: save.id, expectedVersion: 3, stage: 4 };
  assert.equal((await handler(request(move))).status, 200);
  const query = calls.at(-1);
  assert.match(query.sql, /WHERE id=\$3 AND version=\$4/);
  assert.match(query.sql, /tasks=tasks \|\| \$1::jsonb/);
  const tasks = JSON.parse(query.params[0]);
  assert.equal(tasks.state_exam_passed.done, true);
  assert.equal(tasks.license_application.done, true);
  assert.equal(tasks.license_uploaded.done, true);
  assert.equal(tasks.ce_courses.done, false);
  assert.equal(tasks.eo_active.done, false);
  assert.equal(tasks.appointed.done, false);
  assert.equal(query.params[3], 3);
  stale = true;
  assert.equal((await handler(request(move))).status, 409);
  stale = false;
  assert.equal((await handler(request({ ...move, stage: 7 }))).status, 400);
  admin = false;
  assert.equal((await handler(request(move))).status, 403);
});
