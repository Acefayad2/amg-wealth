import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes, scryptSync } from 'node:crypto';
import { transform } from 'esbuild';
import { mondayOf, addDays, examTimeLabel } from '../admin/licensing-calendar.mjs';
import { examCalendarIcs, checkCalendarPin, hashUnlock } from '../netlify/functions/_shared/licensing-calendar-core.mjs';

test('weeks run Monday through Sunday across month/year and daylight saving boundaries', () => {
  assert.equal(mondayOf('2026-11-15'), '2026-11-09');
  assert.equal(mondayOf('2026-11-09'), '2026-11-09');
  assert.equal(addDays('2026-12-28', 6), '2027-01-03');
  assert.equal(addDays('2026-11-02', -7), '2026-10-26');
  assert.equal(examTimeLabel('14:30:00'), '2:30 PM');
  assert.equal(examTimeLabel('00:00'), '12:00 AM');
  assert.equal(examTimeLabel(null), 'Time not set');
});
const salt = 'a'.repeat(32), pinHash = salt + ':' + scryptSync('unit-test-pin', salt, 64).toString('hex');
test('calendar password is verified against a salted hash and rejects wrong or malformed inputs', () => {
  assert.equal(checkCalendarPin('unit-test-pin', pinHash), true);
  assert.equal(checkCalendarPin('wrong', pinHash), false);
  assert.equal(checkCalendarPin('unit-test-pin', 'invalid'), false);
  assert.equal(checkCalendarPin({}, pinHash), false);
});
const exam = { id: 'test-exam', name: 'Jordan, Sample\nBEGIN:VEVENT', track: 'health', exam_date: '2026-11-12', exam_time: '14:30:00', version: 3, updated_at: '2026-11-10T18:00:00Z', email: 'private@example.test', phone: '+12025550123' };
test('feed preserves Eastern exam times, date-only bookings, stable ids and versions without contact details', () => {
  const ics = examCalendarIcs([exam, { ...exam, id:'date-only', exam_time:null, name:'É'.repeat(100) }]);
  assert.match(ics, /DTSTART;TZID=America\/New_York:20261112T143000/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261112/);
  assert.match(ics, /UID:amg-license-test-exam@anointedmoneygroup.com/);
  assert.match(ics, /SEQUENCE:3/);
  assert.match(ics, /TZID:America\/New_York/);
  assert.match(ics, /Jordan\\, Sample\\nBEGIN:VEVENT/);
  assert.equal((ics.match(/^BEGIN:VEVENT$/gm)||[]).length, 2);
  assert(!ics.includes(exam.email)); assert(!ics.includes(exam.phone));
  assert(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
});

let admin = true, attempts = 1, access = false, unlockHash = '', feedToken = 'b'.repeat(64), feedAllowed = true;
const calls = [];
globalThis.__amgCalendarTest = {
  randomBytes, checkCalendarPin, hashUnlock, examCalendarIcs,
  getAuthenticatedUser: async () => ({ user:{id:'admin-id'} }),
  getInquiryPool: () => ({query: async (sql, params) => {
    calls.push({sql,params});
    if (sql.includes('crm_admins')) return {rows:admin ? [{ok:1}] : []};
    if (sql.startsWith('INSERT INTO amg_private.licensing_calendar_access')) return {rows:[{attempts}]};
    if (sql.startsWith('SELECT pin_hash')) return {rows:[{pin_hash:pinHash}]};
    if (sql.startsWith('UPDATE amg_private.licensing_calendar_access')) {unlockHash=params[1];access=true;return {rows:[]};}
    if (sql.includes('unlock_expires_at>now()')) return {rows:access && params[1]===unlockHash ? [{ok:1}] : []};
    if (sql.startsWith('UPDATE amg_private.licensing_calendar_settings')) {feedToken=params[0];return {rows:[]};}
    if (sql.startsWith('SELECT feed_token')) return {rows:[{feed_token:feedToken}]};
    if (sql.includes('WHERE singleton=true AND feed_token')) return {rows:feedAllowed && params[0]===feedToken ? [{ok:1}] : []};
    if (sql.includes('FROM amg_private.licensing_people')) return {rows:[exam]};
    throw Error('Unexpected query');
  }})
};
async function loadHandler(filename) {
  let source = await fs.readFile(new URL('../netlify/functions/'+filename, import.meta.url),'utf8');
  source=source.replace(/^import .*?;\n/gm,'');
  source='const { randomBytes, getAuthenticatedUser, getInquiryPool, checkCalendarPin, hashUnlock, examCalendarIcs }=globalThis.__amgCalendarTest;\n'+source;
  const {code}=await transform(source,{loader:'ts',format:'esm'});
  return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).default;
}
const settings=await loadHandler('licensing-calendar-settings.mts');
const feed=await loadHandler('licensing-exams-feed.mts');
const request=(body,token='')=>new Request('https://amg.example/api/licensing-calendar-settings',{method:'POST',headers:{origin:'https://amg.example','content-type':'application/json','x-calendar-unlock':token},body:JSON.stringify(body)});
test('settings require admin access and the correct code, rate limit attempts, and bind the unlock session', async () => {
  admin=false;
  assert.equal((await settings(request({action:'unlock',password:'unit-test-pin'}))).status,403);
  admin=true;access=false;attempts=6;
  assert.equal((await settings(request({action:'unlock',password:'unit-test-pin'}))).status,429);
  attempts=1;
  assert.equal((await settings(request({action:'unlock',password:'wrong'}))).status,403);
  const locked=await settings(request({action:'status'}));assert.equal(locked.status,403);assert(!(await locked.text()).includes(feedToken));
  const unlocked=await settings(request({action:'unlock',password:'unit-test-pin'}));assert.equal(unlocked.status,200);
  const token=(await unlocked.json()).unlock;
  assert.match(token,/^[a-f0-9]{64}$/);
  const result=await settings(request({action:'status'},token));assert.equal(result.status,200);
  assert.match((await result.json()).googleUrl,/calendar.google.com/);
  assert.equal((await settings(request({action:'status'},'c'.repeat(64)))).status,403);
  access=false;
  assert.equal((await settings(request({action:'status'},token))).status,403);
});
test('subscription requires the private token and returns only calendar data', async () => {
  const before=calls.length;
  assert.equal((await feed(new Request('https://amg.example/api/licensing-exams.ics?token=bad'))).status,404);
  assert.equal(calls.length,before);
  feedAllowed=false;
  assert.equal((await feed(new Request('https://amg.example/api/licensing-exams.ics?token='+feedToken))).status,404);
  feedAllowed=true;
  const result=await feed(new Request('https://amg.example/api/licensing-exams.ics?token='+feedToken));
  assert.equal(result.status,200);assert.match(result.headers.get('content-type'),/text\/calendar/);
  assert.match(await result.text(),/BEGIN:VCALENDAR/);
});
