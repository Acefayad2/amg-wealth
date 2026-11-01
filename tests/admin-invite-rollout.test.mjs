import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { invitationCors } from '../supabase/functions/amg-admin-phone-otp/cors.mjs';
import { canonicalPhone, handleVerifiedSmsEvent } from '../supabase/functions/amg-auth-sms-hook/core.mjs';
const userId = '11111111-1111-4111-8111-111111111111';
const event = { user: { id: userId, phone: '12025550123' }, sms: { otp: '123456' } };
const migration = fs.readFileSync(new URL('../database/migrations/20261030163547_admin_invitation_onboarding.sql', import.meta.url), 'utf8');
const hook = fs.readFileSync(new URL('../supabase/functions/amg-auth-sms-hook/index.ts', import.meta.url), 'utf8');
function fixture({ authorized = true, providerThrows = false, recordThrows = false } = {}) {
  const ledger = new Map(); let allowance = authorized ? 1 : 0; let posts = 0;
  const deliveryStore = {
    async claim({ webhookId, userId: id, phone }) {
      assert.equal(id, userId); assert.equal(phone, '+12025550123');
      if (ledger.has(webhookId)) return ledger.get(webhookId) === 'sent' ? 'sent' : 'blocked';
      if (!allowance) return 'blocked';
      allowance -= 1; ledger.set(webhookId, 'sending'); return 'send';
    },
    async record(id, status) { if (recordThrows) throw Error('db unavailable'); ledger.set(id, status); },
  };
  const config = { quoKey: 'test', phoneNumberId: 'PNqGQouhRT', webhookId: 'event-1', deliveryStore };
  const fetcher = async (_url, options = {}) => {
    if (options.method !== 'POST') return new Response(JSON.stringify({ data: [] }));
    posts += 1;
    assert.deepEqual(JSON.parse(options.body).to, ['+12025550123']);
    if (providerThrows) throw Error('timeout after possible acceptance');
    return new Response(JSON.stringify({ data: { id: 'test-receipt' } }), { status: 202 });
  };
  return { config, fetcher, ledger, posts: () => posts };
}
test('production OTP preflight and all responses have restricted origin headers', () => {
  const req = new Request('https://example.test', { method: 'OPTIONS', headers: { origin: 'https://anointedmoneygroup.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,apikey,content-type' } });
  const { response } = invitationCors(req);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://anointedmoneygroup.com');
  assert.match(response.headers.get('access-control-allow-headers'), /authorization, apikey, content-type/);
  const post = invitationCors(new Request('https://example.test', { method: 'POST', headers: { origin: 'https://anointedmoneygroup.com' } }));
  assert.equal(post.response, null); assert.equal(post.headers['access-control-allow-origin'], 'https://anointedmoneygroup.com');
  for (const origin of ['https://attacker.test', 'https://anointedmoneygroup.com.attacker.test', 'null', '']) {
    const denied = invitationCors(new Request('https://example.test', { method: 'OPTIONS', headers: { origin } })).response;
    assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
});
test('phone canonicalization accepts Supabase digits or E164 only', () => {
  assert.equal(canonicalPhone('12025550123'), '+12025550123');
  assert.equal(canonicalPhone('+12025550123'), '+12025550123');
  for (const value of ['++12025550123', '1 2025550123', '02025550123', 'abc', '']) assert.equal(canonicalPhone(value), null);
});
test('signed-hook repeated and concurrent delivery is claimed once', async () => {
  const f = fixture();
  const results = await Promise.all([handleVerifiedSmsEvent(event, f.config, f.fetcher), handleVerifiedSmsEvent(event, f.config, f.fetcher)]);
  assert.equal(results.filter(x => x.status === 200).length, 1); assert.equal(f.posts(), 1);
  assert.equal((await handleVerifiedSmsEvent(event, f.config, f.fetcher)).status, 200);
  assert.equal(f.posts(), 1);
  assert.equal((await handleVerifiedSmsEvent(event, { ...f.config, webhookId: 'replay-new-id' }, f.fetcher)).status, 403);
  assert.equal(f.posts(), 1);
});
test('uncertain provider delivery and failed ledger writes cannot retry', async () => {
  for (const options of [{ providerThrows: true }, { recordThrows: true }]) {
    const f = fixture(options);
    assert.equal((await handleVerifiedSmsEvent(event, f.config, f.fetcher)).status, 503);
    assert.equal((await handleVerifiedSmsEvent(event, f.config, f.fetcher)).status, 403);
    assert.equal(f.posts(), 1); assert.ok(['sending', 'uncertain'].includes(f.ledger.get('event-1')));
  }
});
test('direct Auth OTP without active authorized request fails before any provider call', async () => {
  const f = fixture({ authorized: false });
  assert.equal((await handleVerifiedSmsEvent(event, f.config, f.fetcher)).status, 403); assert.equal(f.posts(), 0);
  assert.equal((await handleVerifiedSmsEvent({ ...event, user: { phone: event.user.phone } }, f.config, f.fetcher)).status, 400);
});
test('database gates normalize identity, lock claims, preserve uncertain sends and deny public delivery RPC access', () => {
  assert.match(migration, /invite.status IN \('prepared', 'uncertain'\)/);
  assert.match(migration, /canonical_invite_phone\(u.phone\) = i.phone/g);
  assert.match(migration, /AND provisioned_user_id = auth.uid\(\)/);
  assert.match(migration, /i.provisioned_user_id = u.id/);
  assert.match(migration, /FOR UPDATE OF i/);
  assert.match(migration, /invite.otp_request_count <= invite.otp_hook_claimed_count/);
  assert.match(migration, /INTERVAL '30 seconds'/);
  assert.match(migration, /UNIQUE \(invitation_id, request_number\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public.amg_crm_claim_admin_otp_delivery\(TEXT, UUID, TEXT\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /u.phone_confirmed_at IS NULL/);
  assert.match(hook, /verifyHook\(payload, req.headers, hookSecrets\)[\s\S]*amg_crm_claim_admin_otp_delivery/);
  assert.doesNotMatch(hook, /console\./);
});
test('shared deadline aborts delayed provider, records uncertainty and prevents retry', async () => {
  const f = fixture(); let posts = 0; let aborted = false;
  const fetcher = async (url, options = {}) => {
    if (options.method !== 'POST') return f.fetcher(url, options);
    posts += 1;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
      aborted = true; reject(Error('aborted'));
    }, { once: true }));
  };
  const started = Date.now();
  const result = await handleVerifiedSmsEvent(event, { ...f.config, deadline: started + 1100 }, fetcher);
  assert.equal(result.status, 503); assert.ok(Date.now() - started < 1600);
  assert.equal(aborted, true); assert.equal(f.ledger.get('event-1'), 'uncertain');
  assert.equal((await handleVerifiedSmsEvent(event, f.config, fetcher)).status, 403);
  assert.equal(posts, 1);
});
test('slow history leaves insufficient send budget and never dispatches later', async () => {
  const f = fixture(); let posts = 0;
  const fetcher = async (url, options = {}) => {
    if (options.method === 'POST') { posts += 1; return f.fetcher(url, options); }
    await new Promise(resolve => setTimeout(resolve, 250));
    return new Response(JSON.stringify({ data: [] }));
  };
  const result = await handleVerifiedSmsEvent(event, { ...f.config, deadline: Date.now() + 1100 }, fetcher);
  assert.equal(result.status, 503); assert.equal(posts, 0);
  assert.equal(f.ledger.get('event-1'), 'failed');
});
test('hanging claim or response body is bounded and cannot dispatch after timeout', async () => {
  for (const phase of ['claim', 'body']) {
    const f = fixture(); let posts = 0;
    if (phase === 'claim') f.config.deliveryStore.claim = () => new Promise(() => {});
    const fetcher = async (_url, options = {}) => {
      if (options.method === 'POST') posts += 1;
      return { ok: true, json: () => new Promise(() => {}) };
    };
    const started = Date.now();
    assert.equal((await handleVerifiedSmsEvent(event, { ...f.config, deadline: started + 650 }, fetcher)).status, 503);
    assert.ok(Date.now() - started < 1200); assert.equal(posts, 0);
  }
});
test('outcome RPC uses remaining request budget, leaving sending claim fail closed', async () => {
  const f = fixture(); f.config.deliveryStore.record = () => new Promise(() => {});
  const started = Date.now();
  assert.equal((await handleVerifiedSmsEvent(event, { ...f.config, deadline: started + 1100 }, f.fetcher)).status, 503);
  assert.ok(Date.now() - started < 1600); assert.equal(f.ledger.get('event-1'), 'sending');
  assert.equal((await handleVerifiedSmsEvent(event, f.config, f.fetcher)).status, 403);
  assert.equal(f.posts(), 1);
});
test('Edge entry points use supported native Deno server API', () => {
  for (const name of ['amg-admin-invite', 'amg-admin-phone-otp', 'amg-auth-sms-hook']) {
    const source = fs.readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
    assert.match(source, /Deno\.serve\(async/);
    assert.doesNotMatch(source, /std@.*http\/server/);
  }
});
