import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { licensingSteps, licensingProgress, selectedStepsForStage, stepUpdates } from '../licensing-progress/steps.js';
const source = fs.readFileSync(new URL('../src/admin.mjs', import.meta.url), 'utf8');
const openSource = source.slice(source.indexOf('function openLicensingPerson('), source.indexOf('\nfunction showAdminView('));
const listeners = source.slice(source.indexOf('$("#license-exam-status").addEventListener'), source.indexOf('\n$("#licensing-list").addEventListener("input"'));
function setup(person) {
  const fields = new Map(), callbacks = new Map(), requests = [];
  const $ = selector => {
    if (!fields.has(selector)) fields.set(selector, { value: '', textContent: '', disabled: false, innerHTML: '', reset() {}, close() {}, showModal() {}, querySelector: () => ({ disabled: false }), addEventListener: (type, fn) => callbacks.set(`${selector}:${type}`, fn) });
    return fields.get(selector);
  };
  const context = vm.createContext({ $, sessionRevision: 0, licensingStageEdited: false, selectedStepsForStage,
    licensingSlider: person => { $('#license-stage-editor').value = String(licensingProgress(person || {}).current < 0 ? 6 : licensingProgress(person || {}).current + 1); return ''; },
    updateLicensingSlider() {}, licensingApi: async payload => requests.push(payload), loadLicensing: async () => {}, loadExamCalendar: async () => {}, toast() {},
  });
  vm.runInContext(openSource + listeners, context);
  context.openLicensingPerson(person);
  return { $, fields, requests, context, changeStatus(value) { $('#license-exam-status').value = value; callbacks.get('#license-exam-status:change')({ target: $('#license-exam-status') }); }, move(value) { const input = $('#license-stage-editor'); input.value = String(value); input.matches = () => true; callbacks.get('#license-steps:input')({ target: input }); }, save: () => callbacks.get('#licensing-person-form:submit')({ preventDefault() {}, currentTarget: $('#licensing-person-form') }) };
}
const person = { id: '00000000-0000-4000-8000-000000000001', version: 3, name: 'Synthetic learner', email: 'synthetic@example.invalid', track: 'both', exam_status: 'studying', tasks: stepUpdates(['ce_courses'], 'learner') };
test('changing only a name or phone preserves non-sequential completed milestones', async () => {
  const app = setup(person);
  app.$('#license-name').value = 'Renamed synthetic learner';
  app.$('#license-phone').value = '2025550141';
  await app.save();
  const payload = app.requests[0];
  assert.equal(payload.name, 'Renamed synthetic learner');
  assert.equal(Object.hasOwn(payload, 'completedSteps'), false);
});
test('explicit stage changes still apply their intentional sequential milestone update', async () => {
  const app = setup(person); app.move(4); await app.save();
  assert.deepEqual(Array.from(app.requests[0].completedSteps), ['exam_booked', 'state_exam_passed', 'license_uploaded']);
  assert.equal(app.requests[0].examStatus, 'passed');
});
test('explicit exam-status changes synchronize milestones, but reopening clears the edit flag', async () => {
  const app = setup(person); app.changeStatus('passed'); await app.save();
  assert.deepEqual(Array.from(app.requests[0].completedSteps), ['exam_booked', 'state_exam_passed']);
  app.context.openLicensingPerson(person); await app.save();
  assert.equal(Object.hasOwn(app.requests[1], 'completedSteps'), false);
});
test('new people initialize a checklist from the selected stage', async () => {
  const app = setup(null); app.move(3); await app.save();
  assert.deepEqual(Array.from(app.requests[0].completedSteps), ['exam_booked', 'state_exam_passed']);
});
