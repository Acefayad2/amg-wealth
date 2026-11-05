import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { completeAdminInvite } from '../supabase/functions/amg-admin-complete-invite/core.mjs';

const token = 'synthetic-single-use-local-test-token-01';
const tokenHash = createHash('sha256').update(token).digest('hex');
const credentials = { inviteToken: token, email: '  INVITEE@example.test  ', password: 'Example!Password4' };
const origin = 'https://anointedmoneygroup.com';

function fixture({ available = () => true, createError, legacyId, loginId, loginError } = {}) {
  const calls = { checks: 0, creates: [], legacyChecks: [], logins: [], accepts: [], signouts: 0 };
  const providers = {
    client: {
      async rpc(name, payload) {
        assert.equal(payload.p_token_hash, tokenHash);
        if (name === 'amg_crm_admin_invite_available') return { data: available(++calls.checks) };
        assert.equal(name, 'amg_crm_admin_invite_legacy_user');
        calls.legacyChecks.push(payload.p_email);
        return { data: legacyId || null };
      },
      auth: { admin: { async createUser(user) {
        calls.creates.push(user);
        return createError ? { error: createError } : { data: { user: { id: 'new-user' } } };
      } } },
    },
    callerClient: {
      auth: {
        async signInWithPassword(payload) { calls.logins.push(payload); return { error: loginError, data: { user: { id: loginId } } }; },
        async signOut() { calls.signouts++; },
      },
      async rpc(name, payload) {
        assert.equal(name, 'amg_crm_accept_phone_admin_invite');
        calls.accepts.push(payload.p_token);
        return { error: null };
      },
    },
  };
  const submit = (input = credentials, requestOrigin = origin) => completeAdminInvite(new Request(origin, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(input),
  }), providers);
  return { calls, submit };
}

test('opening an active personal link only checks availability; consumed or unknown links return 410', async () => {
  const app = fixture();
  assert.equal((await app.submit({ inviteToken: token, action: 'check' })).status, 200);
  assert.equal(app.calls.checks, 1);
  assert.equal(app.calls.creates.length, 0);
  const inactive = fixture({ available: () => false });
  assert.equal((await inactive.submit()).status, 410);
  assert.equal(inactive.calls.creates.length, 0);
});

test('only the eligible chosen email, password and server-computed claim reach Auth account creation', async () => {
  const app = fixture();
  const response = await app.submit({ ...credentials, phone: '+12025550100', user_id: 'unrelated', role: 'admin', app_metadata: { amg_crm_invite_hash: 'attacker-value' } });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(app.calls.creates, [{ email: 'invitee@example.test', password: credentials.password,
    email_confirm: true, app_metadata: { amg_crm_invite_hash: tokenHash } }]);
  assert.equal(app.calls.logins.length, 0);
});

test('the completion service enforces origin and password constraints before creating an account', async () => {
  const app = fixture();
  assert.equal((await app.submit(credentials, 'https://example.test')).status, 403);
  assert.equal((await app.submit({ ...credentials, password: 'weak' })).status, 400);
  assert.equal((await app.submit({ ...credentials, password: 'Aa1!' + '🚀'.repeat(18) })).status, 400);
  assert.equal(app.calls.creates.length, 0);
});

test('an Auth race or expiry during account creation is handled as a consumed link', async () => {
  const app = fixture({ available: attempt => attempt === 1, createError: { code: 'unexpected_failure' } });
  assert.equal((await app.submit()).status, 410);
  assert.equal(app.calls.checks, 2);
  assert.equal(app.calls.creates.length, 1);
  assert.equal(app.calls.logins.length, 0);
});

test('a duplicate email outside the invitation cannot acquire access through the legacy fallback', async () => {
  const app = fixture({ createError: { code: 'email_exists' } });
  assert.equal((await app.submit()).status, 409);
  assert.deepEqual(app.calls.legacyChecks, ['invitee@example.test']);
  assert.equal(app.calls.logins.length, 0);
  assert.equal(app.calls.accepts.length, 0);
});

test('the historical email/password path accepts only its previously verified signed-in user', async () => {
  for (const [loginId, error, expected] of [['legacy-user', null, 201], ['other-user', null, 409], [null, { code: 'invalid_credentials' }, 409]]) {
    const app = fixture({ createError: { code: 'email_exists' }, legacyId: 'legacy-user', loginId, loginError: error });
    assert.equal((await app.submit()).status, expected);
    assert.deepEqual(app.calls.logins, [{ email: 'invitee@example.test', password: credentials.password }]);
    assert.deepEqual(app.calls.accepts, expected === 201 ? [token] : []);
    assert.equal(app.calls.signouts, error ? 0 : 1);
  }
});
