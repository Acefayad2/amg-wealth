import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import access, { config as accessConfig } from '../netlify/functions/learning-access.mts';
import { accessCookie, GATE_COOKIE, GATE_TTL_SECONDS, issueGate, issueSession, learnerId, normalizeProfile, readAccessCookie, SESSION_COOKIE, SESSION_TTL_SECONDS, validSharedCode, verifyAccessToken } from '../netlify/shared/access-session.ts';
import { getCourseUser } from '../netlify/shared/course-user.ts';
import edge, { config as edgeConfig } from '../netlify/edge-functions/course-access.ts';
import { createLearningHandler } from '../netlify/functions/_shared/learning-service.mjs';

const SECRET = 'local-tests-only-separate-secret-0123456789abcdef';
const CODE = 'local-test-code';
const SITE = 'https://amg.example.test';
const NOW = Date.parse('2026-09-13T00:00:00Z');
function env(t, values = {}) {
  const original = globalThis.Netlify;
  globalThis.Netlify = { env: { get: key => ({ AMG_SESSION_SECRET: SECRET, AMG_REGISTRATION_CODE: CODE, ...values })[key] } };
  t.after(() => { globalThis.Netlify = original; });
}
const request = (body, cookie = '', headers = {}) => new Request(SITE + '/api/access', { method: body === undefined ? 'GET' : 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', Cookie: cookie, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const cookieValue = (response, name) => response.headers.getSetCookie().find(value => value.startsWith(name + '='))?.split(';')[0].slice(name.length + 1);
const cookie = (name, value) => `${name}=${value}`;
const payload = token => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
function signFixture(value, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update('amg-access-v1:' + body).digest('base64url');
}

test('code verification uses the separate secret and exact entered code; missing or oversized values fail', async () => {
  assert.equal(await validSharedCode(CODE, CODE, SECRET), true);
  for (const value of [undefined, '', CODE + ' ', CODE.toUpperCase(), 'x'.repeat(257), 42]) assert.equal(await validSharedCode(value, CODE, SECRET), false);
  assert.equal(await validSharedCode(CODE, '', SECRET), false);
});

test('10-minute gate is signed, purpose-bound and expires exactly at its deadline', async () => {
  const token = await issueGate(SECRET, NOW);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(payload(token).exp - payload(token).iat, GATE_TTL_SECONDS);
  assert.equal((await verifyAccessToken(token, 'gate', SECRET, NOW)).purpose, 'gate');
  assert.equal(await verifyAccessToken(token, 'session', SECRET, NOW), null);
  assert.equal(await verifyAccessToken(token, 'gate', SECRET, NOW + GATE_TTL_SECONDS * 1000), null);
  assert.equal(await verifyAccessToken(token, 'gate', SECRET + '-rotated', NOW), null);
});

test('seven-day profile token normalizes tracking fields and uses a stable private64-hex email UID', async () => {
  const token = await issueSession({ name: '  José   Agent  ', email: ' AGENT@Example.Invalid ' }, SECRET, NOW);
  const session = await verifyAccessToken(token, 'session', SECRET, NOW);
  assert.equal(session.name, 'José Agent'); assert.equal(session.email, 'agent@example.invalid');
  assert.match(session.id, /^[0-9a-f]{64}$/); assert(!session.id.includes('agent'));
  assert.equal(session.exp - session.iat, SESSION_TTL_SECONDS);
  const second = payload(await issueSession({ name: 'Changed Name', email: 'agent@example.invalid' }, SECRET, NOW + 1000));
  assert.equal(second.id, session.id); assert.notEqual(session.id, await learnerId('another@example.invalid', SECRET));
  assert.equal(await verifyAccessToken(token, 'gate', SECRET, NOW), null);
  assert.equal(await verifyAccessToken(token, 'session', SECRET, NOW + SESSION_TTL_SECONDS * 1000), null);
  assert.equal(session.confirmedAt, undefined); assert.equal(session.roles, undefined);
});

test('modified content/signature, extra token segments and malformed encodings cannot authenticate', async () => {
  const token = await issueSession({ name: 'Local Agent', email: 'agent@example.invalid' }, SECRET, NOW);
  const [body, signature] = token.split('.');
  for (const candidate of ['', token + '.more', 'x'.repeat(4097), body + '.AAAA', body + '.' + signature.slice(0, -2) + 'zz', body + '=.' + signature, '!' + token, signFixture(payload(token), SECRET + '-different')]) assert.equal(await verifyAccessToken(candidate, 'session', SECRET, NOW), null);
  const edited = { ...payload(token), email: 'victim@example.invalid' };
  assert.equal(await verifyAccessToken(Buffer.from(JSON.stringify(edited)).toString('base64url') + '.' + signature, 'session', SECRET, NOW), null);
});

test('even signed malformed/overlong/unknown claims and mismatched UID fail payload validation', async () => {
  const good = payload(await issueSession({ name: 'Local Agent', email: 'agent@example.invalid' }, SECRET, NOW));
  for (const changes of [{ v: 2 }, { iat: good.iat + 100, exp: good.exp + 100 }, { iat: -1 }, { exp: good.exp + 1 }, { extra: true }, { name: 'x'.repeat(121) }, { email: ' AGENT@example.invalid ' }, { id: '0'.repeat(64) }]) assert.equal(await verifyAccessToken(signFixture({ ...good, ...changes }), 'session', SECRET, NOW), null);
});

test('profile validation rejects blank/control/overlong names and malformed tracking email addresses', () => {
  for (const [name, email] of [[' ', 'a@example.invalid'], ['x'.repeat(121), 'a@example.invalid'], ['A\nB', 'a@example.invalid'], ['Agent', 'not-email'], ['Agent', 'a@@example.invalid'], ['Agent', 'a@localhost'], ['Agent', 'a@-example.invalid'], ['Agent', 'a..b@example.invalid'], ['Agent', 'a@example..invalid'], ['Agent', 'a@example.invalid\r\n'], [null, 'a@example.invalid']]) assert.equal(normalizeProfile(name, email), null);
  assert.deepEqual(normalizeProfile('  María  Agent ', ' Maria.Agent+test@Example.Invalid '), { name: 'María Agent', email: 'maria.agent+test@example.invalid' });
});

test('cookie reader requires the exact host-only name and rejects duplicate or oversized cookies', () => {
  assert.equal(readAccessCookie(request(undefined, 'other=x; __Host-amg_session=abc.def'), SESSION_COOKIE), 'abc.def');
  for (const value of ['nf_jwt=abc.def', '__Host-amg_session=abc.def; __Host-amg_session=second.copy', '__Host-amg_session=%3B', '__Host-amg_session=' + 'x'.repeat(4097), 'prefix__Host-amg_session=abc.def']) assert.equal(readAccessCookie(request(undefined, value), SESSION_COOKIE), null);
});

test('complete shared-code→profile→ready flow sets only secure HttpOnly host cookies and never sends tokens in JSON', async t => {
  env(t);
  assert.deepEqual(await (await access(request())).json(), { stage: 'code' });
  const codeResponse = await access(request({ action: 'code', code: CODE }));
  assert.deepEqual(await codeResponse.clone().json(), { stage: 'profile' });
  const gate = cookieValue(codeResponse, GATE_COOKIE); assert(gate);
  assert.equal(cookieValue(codeResponse, SESSION_COOKIE), '');
  assert.deepEqual(await (await access(request(undefined, cookie(GATE_COOKIE, gate)))).json(), { stage: 'profile' });
  const start = await access(request({ action: 'start', name: ' Local   Agent ', email: ' AGENT@Example.Invalid ' }, cookie(GATE_COOKIE, gate)));
  assert.equal(start.status, 200);
  const result = await start.json(); assert.equal(result.stage, 'ready');
  assert.equal(result.user.name, 'Local Agent'); assert.equal(result.user.email, 'agent@example.invalid');
  const token = cookieValue(start, SESSION_COOKIE); assert(token); assert.equal(cookieValue(start, GATE_COOKIE), '');
  for (const header of [...codeResponse.headers.getSetCookie(), ...start.headers.getSetCookie()]) { assert.match(header, /; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/); assert(!header.includes('Domain=')); }
  assert(!JSON.stringify(result).includes(token)); assert(!JSON.stringify(result).includes(CODE));
  const ready = await access(request(undefined, cookie(SESSION_COOKIE, token)));
  assert.deepEqual(await ready.json(), result); assert.equal(ready.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await getCourseUser(request(undefined, cookie(SESSION_COOKIE, token))), { ...result.user, accessGranted: true });
});

test('profile entry cannot skip code, borrow an expired gate or use the full session as a gate', async t => {
  env(t); const body = { action: 'start', name: 'Agent', email: 'agent@example.invalid' };
  const expired = await issueGate(SECRET, Date.now() - (GATE_TTL_SECONDS + 1) * 1000);
  const session = await issueSession({ name: 'Agent', email: 'agent@example.invalid' }, SECRET);
  for (const cookies of ['', cookie(GATE_COOKIE, expired), cookie(GATE_COOKIE, session)]) { const response = await access(request(body, cookies)); assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'gate_required' }); }
});

test('wrong code, invalid profile and extra envelope fields never issue a session', async t => {
  env(t);
  const gate = await issueGate(SECRET);
  for (const [body, status] of [[{ action: 'code', code: 'wrong' }, 401], [{ action: 'code', code: CODE, uid: 'forged' }, 400], [{ action: 'start', name: '', email: 'agent@example.invalid' }, 400], [{ action: 'start', name: 'Agent', email: 'bad' }, 400], [{ action: 'start', name: 'Agent', email: 'agent@example.invalid', accessGranted: true }, 400]]) {
    const response = await access(request(body, cookie(GATE_COOKIE, gate))); assert.equal(response.status, status); assert.deepEqual(response.headers.getSetCookie(), []);
  }
});

test('logout clears both cookies and new code entry clears an old learner session', async t => {
  env(t); const token = await issueSession({ name: 'Old Learner', email: 'old@example.invalid' }, SECRET);
  const response = await access(request({ action: 'logout' }, cookie(SESSION_COOKIE, token)));
  assert.deepEqual(await response.json(), { stage: 'code' });
  assert.equal(response.headers.getSetCookie().length, 2);
  for (const value of response.headers.getSetCookie()) assert.match(value, /=; Path=\/; Max-Age=0;/);
  const next = await access(request({ action: 'code', code: CODE }, cookie(SESSION_COOKIE, token)));
  assert.equal(cookieValue(next, SESSION_COOKIE), ''); assert(cookieValue(next, GATE_COOKIE));
});

test('same-origin POST, JSON, strict envelope and announced/streamed4KiB request limits are enforced', async t => {
  env(t);
  for (const action of ['code', 'start', 'logout']) for (const origin of ['', 'https://attacker.invalid', 'null']) assert.equal((await access(request({ action }, '', { Origin: origin }))).status, 403);
  assert.equal((await access(request({ action: 'code', code: CODE }, '', { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await access(request({ action: 'code', code: CODE }, '', { 'Content-Length': '4097' }))).status, 413);
  assert.equal((await access(request({ action: 'code', code: 'x'.repeat(4097) }))).status, 413);
  for (const text of ['{', 'null', '[]']) assert.equal((await access(new Request(SITE + '/api/access', { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: text }))).status, 400);
  assert.equal((await access(new Request(SITE + '/api/access', { method: 'DELETE' }))).status, 405);
});

test('missing or short session secret fails closed without provider details; no Identity token can authorize', async t => {
  env(t, { AMG_SESSION_SECRET: 'short' });
  assert.deepEqual(await (await access(request())).json(), { error: 'access_service_unavailable' });
  assert.equal(await getCourseUser(request(undefined, 'nf_jwt=old-identity-token')), null);
  assert.equal((await access(request({ action: 'code', code: CODE }))).status, 503);
});

test('missing configured access code cannot create a gate', async t => {
  env(t, { AMG_REGISTRATION_CODE: '' });
  const response = await access(request({ action: 'code', code: CODE }));
  assert.equal(response.status, 503); assert.equal(response.headers.getSetCookie().length, 0);
});

test('Edge uses the same signed session; exact login assets stay public while lesson data stays gated and uncached', async t => {
  env(t); let next = 0;
  const context = { next: async () => { next++; return new Response('content', { headers: { 'Cache-Control': 'public, max-age=3600' } }); } };
  for (const path of ['/course/assets/amg-logo.png', '/course/shared/app.css', '/course/shared/account.css', '/course/shared/account.js', '/course/shared/login.js']) assert.equal((await edge(new Request(SITE + path), context)).status, 200);
  assert.equal(next, 5);
  for (const path of ['/course', '/course/', '/course/lesson-01/?review=1', '/course/lesson-01/lesson-data.js', '/course/lesson-01/scene-captions.vtt', '/course/assessments/assessment-data.js']) {
    const response = await edge(new Request(SITE + path), context); assert.equal(response.status, 302); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const target = new URL(response.headers.get('location')); assert.equal(target.origin, SITE); assert.equal(target.pathname, '/login/'); assert.equal(target.searchParams.get('next'), path);
  }
  const token = await issueSession({ name: 'Agent', email: 'agent@example.invalid' }, SECRET);
  const allowed = await edge(new Request(SITE + '/course/lesson-01/', { headers: { Cookie: cookie(SESSION_COOKIE, token) } }), context);
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(edgeConfig, { path: ['/course', '/course/*'], onError: 'fail' });
});

test('real signed session feeds unchanged learning user/report shape and rejects a cross-learner write assertion', async t => {
  env(t);
  const token = await issueSession({ name: 'Agent', email: 'agent@example.invalid' }, SECRET);
  const handler = createLearningHandler({ getUser: getCourseUser, getStore: () => ({ getWithMetadata: async () => null }) });
  const response = await handler(new Request(SITE + '/api/learning?report=1', { headers: { Cookie: cookie(SESSION_COOKIE, token) } }));
  const report = await response.json(); assert.equal(response.status, 200); assert.equal(report.summary.uid, await learnerId('agent@example.invalid', SECRET)); assert.equal(report.lessons.length, 60);
  const conflict = await handler(new Request(SITE + '/api/learning', { method: 'POST', headers: { Cookie: cookie(SESSION_COOKIE, token), Origin: SITE, 'X-AMG-User': 'other-learner', 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal(conflict.status, 403); assert.deepEqual(await conflict.json(), { error: 'account_changed' });
});

test('access config declares platform rate limiting and no obsolete Identity code remains in server entry points', () => {
  assert.deepEqual(accessConfig, { path: '/api/access', method: ['GET', 'POST'], rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } });
  for (const file of ['netlify/shared/course-user.ts', 'netlify/shared/access-session.ts', 'netlify/functions/learning-access.mts', 'netlify/functions/learning.mts', 'netlify/edge-functions/course-access.ts']) {
    const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'); assert(!source.includes('@netlify/identity'), file); assert(!source.includes('nf_jwt'), file);
  }
  for (const file of ['identity.mts', 'identity-validate.mts', 'identity-signup.mts', 'identity-usermodified.mts']) assert.equal(fs.existsSync(new URL('../netlify/functions/' + file, import.meta.url)), false);
  assert.match(accessCookie(SESSION_COOKIE, '', 0), /^__Host-amg_session=;/);
});
