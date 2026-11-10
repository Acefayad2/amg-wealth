import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { scheduledDateTimeUtc, scheduleInputValue } from '../admin/core.mjs';

test('wall times convert using the displayed zone, including half-hour zones', () => {
  assert.equal(scheduledDateTimeUtc('2030-11-12T09:30', 'America/New_York'), '2030-11-12T14:30:00.000Z');
  assert.equal(scheduledDateTimeUtc('2030-07-12T09:30', 'America/New_York'), '2030-07-12T13:30:00.000Z');
  assert.equal(scheduledDateTimeUtc('2030-11-12T09:30', 'Asia/Kolkata'), '2030-11-12T04:00:00.000Z');
});
test('unchanged times retain the exact instant, including either repeated fall-back hour', () => {
  for (const value of ['2030-11-03T05:30:00.000Z', '2030-11-03T06:30:00.000Z', '2030-11-12T14:30:12.000Z']) {
    assert.equal(scheduledDateTimeUtc(scheduleInputValue(value, 'America/New_York'), 'America/New_York', value), value);
  }
});
test('new invalid, nonexistent and ambiguous local times require correction', () => {
  assert.throws(() => scheduledDateTimeUtc('', 'America/New_York'), /valid scheduled/);
  assert.throws(() => scheduledDateTimeUtc('2030-02-31T09:30', 'America/New_York'), /does not exist/);
  assert.throws(() => scheduledDateTimeUtc('2030-03-10T02:30', 'America/New_York'), /does not exist/);
  assert.throws(() => scheduledDateTimeUtc('2030-11-03T01:30', 'America/New_York'), /occurs twice/);
});
test('production scheduled-save handler keeps an Eastern appointment unchanged in Pacific and UTC browsers', async () => {
  const source = fs.readFileSync(new URL('../src/admin.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function saveMessage(status)'), source.indexOf('\nfunction openScheduleSaveConfirmation'));
  const old = process.env.TZ;
  try {
    for (const timezone of ['America/Los_Angeles', 'UTC']) {
      process.env.TZ = timezone;
      const before = '2030-11-12T14:30:00.000Z', fields = new Map();
      const $ = key => { if (!fields.has(key)) fields.set(key, { value: '', setAttribute() {}, removeAttribute() {}, close() {}, focus() {} }); return fields.get(key); };
      $('#scheduled-for').value = scheduleInputValue(before, 'America/New_York'); $('#message-timezone').value = 'America/New_York';
      let payload;
      const context = vm.createContext({ $, sessionRevision: 0, scheduledDateTimeUtc, state: { messageBusy: false, messageEditSnapshot: { scheduled_for: before } }, api: async value => { payload = value; }, load: async () => {}, toast() {}, updateRecipientNote() {} });
      vm.runInContext(body, context); await context.saveMessage('scheduled');
      assert.equal(payload.scheduledFor, before);
      assert.equal(payload.timezone, 'America/New_York');
    }
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
