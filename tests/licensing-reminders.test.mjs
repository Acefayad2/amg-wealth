import test from 'node:test';
import assert from 'node:assert/strict';
import { licensingReminder, licensingReminderLinks } from '../admin/licensing-reminders.mjs';
import { selectedStepsForStage, stepUpdates } from '../licensing-progress/steps.js';
const now = new Date('2026-11-10T18:00:00Z');
const person = stage => ({ name: 'Jordan Sample', track: 'health', phone: '(202) 555-0123', email: 'jordan@example.test', tasks: stepUpdates(selectedStepsForStage(stage), 'admin') });

test('each current stage prepares its own personalized text and email', () => {
  const checks = [/book your Health exam/, /Health exam step/, /buy your state license/, /CE and E&O/, /carrier appointments/, /All five licensing steps/];
  const texts = [];
  checks.forEach((expected, i) => {
    const draft = licensingReminder(person(i + 1), now);
    assert.match(draft.text, expected);
    assert.match(draft.text, /^Hi Jordan,/);
    assert.match(draft.email, /^Hi Jordan,\n\n/);
    assert.match(draft.email, /https:\/\/anointedmoneygroup.com\/licensing-progress\//);
    assert.match(draft.subject, /^Jordan, /);
    assert(!draft.text.includes('undefined'));
    texts.push(draft.text);
  });
  assert.equal(new Set(texts).size, 6);
});
test('exam reminder uses scheduled date, past result check, or retake status', () => {
  const scheduled = { ...person(2), exam_date: '2026-11-20' };
  assert.match(licensingReminder(scheduled, now).text, /scheduled for November 20, 2026/);
  const past = { ...scheduled, exam_date: '2026-11-08' };
  assert.match(licensingReminder(past, now).text, /How did your Health exam on November 8, 2026 go/);
  const retake = { ...scheduled, exam_status: 'failed' };
  assert.match(licensingReminder(retake, now).text, /retake planned/);
  assert.doesNotMatch(licensingReminder(retake, now).text, /scheduled for/);
});
test('Messages links include one normalized recipient and an encoded current-stage draft', () => {
  const apple = licensingReminderLinks(person(3), { userAgent: 'iPhone' }, now);
  assert.match(apple.text, /^sms:\+12025550123&body=/);
  assert.equal(decodeURIComponent(apple.text.split('&body=')[1]), licensingReminder(person(3), now).text);
  const android = licensingReminderLinks(person(4), { userAgent: 'Android' }, now);
  const uri = new URL(android.text);
  assert.equal(uri.protocol, 'sms:');
  assert.equal(uri.searchParams.get('body'), licensingReminder(person(4), now).text);
  assert.match(licensingReminderLinks(person(5), { platform: 'MacIntel' }, now).text, /&body=/);
});
test('email link fills recipient, subject and full body; missing contacts do not create broken links', () => {
  const value = person(4);
  const links = licensingReminderLinks(value, {}, now);
  const uri = new URL(links.email);
  assert.equal(decodeURIComponent(uri.pathname), value.email);
  assert.equal(uri.searchParams.get('subject'), licensingReminder(value, now).subject);
  assert.equal(uri.searchParams.get('body'), licensingReminder(value, now).email);
  assert.deepEqual(licensingReminderLinks({ name: 'Jordan', phone: '', email: '' }, {}, now), { text: null, email: null });
  assert.equal(licensingReminderLinks({ ...value, phone: 'not a number' }, {}, now).text, null);
});
