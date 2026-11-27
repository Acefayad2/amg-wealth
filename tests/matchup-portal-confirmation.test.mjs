import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const functionRoot = new URL('../integrations/matchup-backend/supabase/functions/amg-matchup/', import.meta.url);
const source = (await readFile(new URL('index.ts', functionRoot), 'utf8')).replace(/^import .*;\n/gm, '');
const handlerCode = (await transform(source, { loader: 'ts' })).code;
const helpersCode = (await transform(await readFile(new URL('appointment.ts', functionRoot), 'utf8'), { loader: 'ts', format: 'cjs' })).code;
const helperModule = { exports: {} };
vm.runInNewContext(helpersCode, { module: helperModule, exports: helperModule.exports });

async function bookingHandler(replay = null) {
  const requests = [], rpcs = [];
  let handler;
  const database = {
    from(table) {
      let columns;
      const query = {
        select(value) { columns = value; return query; },
        eq() { return query; }, ilike() { return query; }, in() { return query; }, limit() { return query; },
        async maybeSingle() {
          const data = table === 'matchup_appointments'
            ? (columns.startsWith('id,') ? replay : { status: 'confirmed', google_meet_url: '' })
            : table === 'cft_contacts' ? { email: 'trainer@example.invalid' } : null;
          return { data, error: null };
        },
      };
      return query;
    },
    async rpc(name) {
      rpcs.push(name);
      return { data: name === 'book_matchup_appointment' ? 'test-appointment'
        : name === 'queue_matchup_calendar' ? { status: 'pending' } : null, error: null };
    },
  };
  vm.runInNewContext(handlerCode, {
    ...helperModule.exports, Response, Request, URLSearchParams, TextEncoder, crypto, console,
    createClient: () => database,
    Deno: {
      serve: value => { handler = value; },
      env: { get: key => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
        RESEND_API_KEY: 'configured-test-only', APPOINTMENT_FROM_EMAIL: 'test@example.invalid' })[key] },
    },
    fetch: async (...args) => { requests.push(args); return Response.json({ id: 'unexpected-email' }); },
  });
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const response = await handler(new Request('https://example.invalid', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://anointedmoneygroup.com' },
    body: JSON.stringify({ action: 'book', bookingId: 'da073bcf-6927-4b70-9b34-cd274e392ab9',
      trainer: { id: 'test-trainer', name: 'QA Trainer' },
      agent: { name: 'QA Agent', email: 'agent@example.invalid', phone: '2025550100' },
      client: { name: 'QA Client', email: 'client@example.invalid', phone: '2025550101' },
      notificationConsent: { agent: false, client: false, version: 'appointment-sms-v1' },
      appointment: { date, time: '3:00 PM', description: 'Test booking; do not contact.', focus: 'Retirement', background: 'Retirement', format: 'Video call' },
    }),
  }));
  return { response, receipt: await response.json(), requests, rpcs };
}

test('a saved booking returns a portal receipt without sending email, even when delivery credentials exist', async () => {
  const { response, receipt, requests, rpcs } = await bookingHandler();
  assert.equal(response.status, 200);
  assert.equal(receipt.appointmentId, 'test-appointment');
  assert.equal(receipt.calendarStatus, 'pending');
  assert.equal(receipt.appointmentStatus, 'confirmed');
  assert.equal(receipt.smsStatus, 'not_requested');
  assert.equal('emailStatus' in receipt, false);
  assert.deepEqual(requests, []);
  assert.equal(rpcs.filter(name => name === 'book_matchup_appointment').length, 1);
  assert.ok(rpcs.includes('queue_matchup_calendar'));
});

test('replaying a booking returns the original receipt without email or a second reservation', async () => {
  const { response, receipt, requests, rpcs } = await bookingHandler({ id: 'original-appointment', status: 'pending', google_calendar_status: 'synced', google_meet_url: '' });
  assert.equal(response.status, 200);
  assert.equal(receipt.appointmentId, 'original-appointment');
  assert.equal(receipt.appointmentStatus, 'pending');
  assert.equal('emailStatus' in receipt, false);
  assert.deepEqual(requests, []);
  assert.deepEqual(rpcs, []);
});
