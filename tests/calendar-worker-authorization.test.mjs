import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarWorkerAuthorized } from '../integrations/matchup-backend/supabase/functions/amg-calendar-worker/authorization.ts';

const secret = 'calendar-worker-test-key-'.repeat(3);
test('the calendar worker requires its dedicated scheduler secret', () => {
  assert.equal(calendarWorkerAuthorized(new Headers({ 'x-amg-calendar-key': secret }), secret), true);
  assert.equal(calendarWorkerAuthorized(new Headers({ Authorization: 'Bearer public-anon-key' }), secret), false);
  assert.equal(calendarWorkerAuthorized(new Headers({ 'x-amg-calendar-key': 'wrong' }), secret), false);
  assert.equal(calendarWorkerAuthorized(new Headers({ 'x-amg-calendar-key': '' }), ''), false);
  assert.equal(calendarWorkerAuthorized(new Headers({ 'x-amg-calendar-key': 'short' }), 'short'), false);
});
test('legacy appointment-worker credentials remain isolated and supported', () => {
  assert.equal(calendarWorkerAuthorized(new Headers({ 'x-amg-appointment-key': secret }), '', secret), true);
  assert.equal(calendarWorkerAuthorized(new Headers({ 'x-amg-appointment-key': secret }), secret), false);
});
