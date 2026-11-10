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
source = `import { licensingSteps, stepUpdates, selectedStepsForStage } from ${JSON.stringify(helpers)};\nconst { getInquiryPool, getAuthenticatedUser, getCourseUser, normalizeUsPhone, getStore, learnerId, learningIdentity, deleteLicensingPerson } = globalThis.__amgLicensingTest;\n` + source;
const calls = [];
let admin = true, stale = false;
globalThis.__amgLicensingTest = {
  getStore: () => ({}),
  learnerId: async email => 'test-base-user',
  learningIdentity: async (store,user) => ({ ...user, resetGeneration:false }),
  deleteLicensingPerson: async (pool,store,id,version) => { calls.push({sql:'ERASE_LEARNING_AND_DELETE',params:[id,version]}); return stale ? null : {id}; },
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
  assert.match(query.sql, /WHERE id=\$18 AND version=\$19/);
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


test('admin saves a normalized recruiter phone, can clear it, and preserves it for older clients', async () => {
  admin = true; stale = false;
  assert.equal((await handler(request({ ...save, recruiterPhone: '(301) 555-0142' }))).status, 200);
  assert.equal(calls.at(-1).params[13], '+13015550142');
  assert.equal(calls.at(-1).params[14], true);
  assert.match(calls.at(-1).sql, /ELSE recruiter_phone END/);
  assert.equal((await handler(request({ ...save, recruiterPhone: '' }))).status, 200);
  assert.equal(calls.at(-1).params[13], null);
  assert.equal(calls.at(-1).params[14], true);
  await handler(request(save));
  assert.equal(calls.at(-1).params[14], false);
  assert.equal((await handler(request({ ...save, recruiterPhone: '123' }))).status, 400);
});
test('category filters are allowlisted, use actual license/E&O milestones, and include today’s follow ups', async () => {
  admin = true;
  for (const category of ['all', 'unlicensed', 'licensed', 'eo_completed', 'appointed', 'follow_ups_due']) {
    calls.length = 0;
    const response = await handler(new Request('https://amg.example/api/licensing-pipeline?category=' + category, { headers: { authorization: 'Bearer test' } }));
    assert.equal(response.status, 200);
    const list = calls.find(call => call.sql.includes('LIMIT 25'));
    const counts = calls.find(call => call.sql.includes('AS tracked'));
    assert.match(counts.sql, /tasks->'license_uploaded'/);
    assert.match(counts.sql, /tasks->'eo_active'/);
    assert.match(counts.sql, /follow_up_date <= \(now\(\) AT TIME ZONE 'America\/New_York'\)::date/);
    if (category === 'licensed') assert.match(list.sql, /AND \(coalesce\(\(tasks->'license_uploaded'/);
    if (category === 'eo_completed') assert.match(list.sql, /AND \(coalesce\(\(tasks->'eo_active'/);
  }
  const invalid = await handler(new Request('https://amg.example/api/licensing-pipeline?category=unknown', { headers: { authorization: 'Bearer test' } }));
  assert.equal(invalid.status, 400);
});

test('admin can save or clear an exam time and older clients preserve it', async () => {
  admin=true;stale=false;
  assert.equal((await handler(request({...save,examDate:'2026-11-12',examTime:'14:30'}))).status,200);
  assert.equal(calls.at(-1).params[15],'14:30');
  assert.equal(calls.at(-1).params[16],true);
  assert.match(calls.at(-1).sql,/ELSE exam_time END/);
  assert.equal((await handler(request({...save,examDate:'2026-11-12',examTime:''}))).status,200);
  assert.equal(calls.at(-1).params[15],null);
  await handler(request(save));assert.equal(calls.at(-1).params[16],false);
  assert.equal((await handler(request({...save,examDate:'2026-11-12',examTime:'25:00'}))).status,400);
  assert.equal((await handler(request({...save,examDate:'',examTime:'14:00'}))).status,400);
});
test('weekly exam query spans seven days and includes all bookings beyond list pagination', async () => {
  admin=true;calls.length=0;
  assert.equal((await handler(new Request('https://amg.example/api/licensing-pipeline?calendar_week=2026-11-09',{headers:{authorization:'Bearer test'}}))).status,200);
  const query=calls.at(-1);
  assert.match(query.sql,/exam_date >= \$1::date AND exam_date < \$1::date \+ 7/);
  assert(!query.sql.includes('LIMIT 25'));
  assert.deepEqual(query.params,['2026-11-09']);
  assert.equal((await handler(new Request('https://amg.example/api/licensing-pipeline?calendar_week=2026-11-10',{headers:{authorization:'Bearer test'}}))).status,400);
});

test('only an administrator can delete a person, with explicit confirmation and their current version', async () => {
  const deletion = { action: 'delete_person', id: save.id, expectedVersion: 3, confirmDelete: true };
  admin = false; calls.length = 0;
  assert.equal((await handler(request(deletion))).status, 403);
  assert.equal(calls.length, 0);
  admin = true;
  for (const patch of [{ confirmDelete: false }, { expectedVersion: null }, { expectedVersion: 0 }, { id: 'bad-id' }]) {
    calls.length = 0;
    assert.equal((await handler(request({ ...deletion, ...patch }))).status, 400);
    assert(!calls.some(call => call.sql.startsWith('DELETE')));
  }
  calls.length = 0; stale = false;
  const result = await handler(request(deletion));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { deleted: true, id: save.id });
  const query = calls.at(-1);
  assert.equal(query.sql, 'ERASE_LEARNING_AND_DELETE');
  assert.deepEqual(query.params, [save.id, 3]);
  stale = true;
  assert.equal((await handler(request(deletion))).status, 409);
  stale = false;
});
