import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeGoogleCalendar, calendarCallbackError } from '../lib/calendar-authorization.ts';

function authRecorder() {
  const calls = [];
  return { calls, auth: {
    signInWithOAuth: async request => { calls.push({ method: 'reauthorize', request }); return { error: null }; },
    linkIdentity: async request => { calls.push({ method: 'link', request }); return { error: null }; },
  } };
}

test('a linked Google account reauthorizes instead of failing by linking twice', async () => {
  const { calls, auth } = authRecorder();
  await authorizeGoogleCalendar(auth, { identities: [{ provider: 'email' }, { provider: 'google', identity_data: { email: 'trainer@example.com' } }] }, 'https://anointedmoneygroup.com');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'reauthorize');
  assert.equal(calls[0].request.options.queryParams.login_hint, 'trainer@example.com');
  assert.equal(calls[0].request.options.queryParams.access_type, 'offline');
  assert.equal(calls[0].request.options.queryParams.prompt, 'consent');
  assert.equal(calls[0].request.options.redirectTo, 'https://anointedmoneygroup.com/matchups/cft/');
  assert.match(calls[0].request.options.scopes, /calendar.events.freebusy/);
  assert.match(calls[0].request.options.scopes, /calendar.events.owned/);
});

test('first-time calendar connection links Google to the existing trainer login', async () => {
  const { calls, auth } = authRecorder();
  await authorizeGoogleCalendar(auth, { identities: [{ provider: 'email' }] }, 'https://anointedmoneygroup.com');
  assert.equal(calls[0].method, 'link');
  assert.equal(calls[0].request.options.queryParams.login_hint, undefined);
});

test('OAuth callback failures are shown and successful token callbacks are not mislabeled', () => {
  assert.match(calendarCallbackError('', '#error=server_error&error_description=Identity+is+already+linked'), /already linked.*refresh/);
  assert.match(calendarCallbackError('?error=access_denied', ''), /declined/);
  assert.match(calendarCallbackError('', '#error=server_error&error_description=Some+provider+failure'), /couldn’t be connected/);
  assert.equal(calendarCallbackError('', '#access_token=example&provider_refresh_token=example'), '');
});
