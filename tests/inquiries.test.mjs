import assert from 'node:assert/strict';
import test from 'node:test';
import { createInquirySubmitHandler, createInquiryListHandler } from '../netlify/functions/_shared/inquiries.mts';

const origin = 'https://amg-inquiry-test.invalid';
const valid = {
  submissionId: '64d90251-ac1d-4cd2-9413-ab9150b6db19',
  fullName: '  Website QA  ',
  email: '  QA@EXAMPLE.INVALID  ',
  phone: '+1 (202) 555-0123',
  interest: 'Financial Education',
  message: 'Please explain the next steps.\nThank you.',
  botField: '',
};
function submission(payload = valid, options = {}) {
  return new Request(`${origin}/.netlify/functions/submit-inquiry`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...options.headers },
    body: options.body ?? JSON.stringify(payload),
  });
}
function nativeSubmission(overrides = {}) {
  return new Request(`${origin}/.netlify/functions/submit-inquiry`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      'full-name': 'Website QA', email: 'qa@example.invalid', phone: '',
      interest: valid.interest, goals: valid.message, 'bot-field': '', submissionId: '',
      ...overrides,
    }),
  });
}

test('public success waits for persistence, normalizes input, and returns no contact data', async () => {
  let release;
  let saved;
  let entered;
  const saving = new Promise(resolve => { entered = resolve; });
  const persistence = new Promise(resolve => { release = resolve; });
  const handler = createInquirySubmitHandler(async inquiry => {
    saved = inquiry;
    entered();
    return persistence;
  });
  let settled = false;
  const responsePromise = handler(submission()).then(response => { settled = true; return response; });
  await saving;
  assert.equal(settled, false, 'a thank-you response must not precede durable saving');
  assert.deepEqual(saved, {
    id: valid.submissionId, fullName: 'Website QA', email: 'qa@example.invalid',
    phone: valid.phone, interest: valid.interest, message: valid.message,
  });
  release(true);
  const response = await responsePromise;
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true });
});

test('retrying the same submission preserves its id and content; conflicting content gets 409', async () => {
  const saved = new Map();
  const handler = createInquirySubmitHandler(async inquiry => {
    const prior = saved.get(inquiry.id);
    if (prior) return JSON.stringify(prior) === JSON.stringify(inquiry);
    saved.set(inquiry.id, inquiry);
    return true;
  });
  assert.equal((await handler(submission())).status, 201);
  assert.equal((await handler(submission())).status, 201);
  assert.equal(saved.size, 1);
  const conflict = await handler(submission({ ...valid, message: 'Changed content with the same id' }));
  assert.equal(conflict.status, 409);
  assert.equal(saved.get(valid.submissionId).message, valid.message);
});

test('storage failure is retryable and never leaks database errors or redirects to success', async () => {
  const handler = createInquirySubmitHandler(async () => {
    throw new Error('postgres://user:secret@private-db.invalid/inquiries');
  });
  for (const req of [submission(), nativeSubmission()]) {
    const response = await handler(req);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('location'), null);
    const text = await response.text();
    assert.match(text, /could not be saved/);
    assert.doesNotMatch(text, /secret|private-db/);
  }
});

test('native no-JavaScript submissions retain field values and get an id before redirect', async () => {
  const saved = [];
  const handler = createInquirySubmitHandler(async inquiry => { saved.push(inquiry); return true; });
  const response = await handler(nativeSubmission());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/thank-you.html');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(saved.length, 1);
  assert.match(saved[0].id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  assert.equal(saved[0].fullName, 'Website QA');
  assert.equal(saved[0].message, valid.message);
  assert.equal(saved[0].phone, '');
});

test('honeypot submissions have no database side effect for either supported encoding', async () => {
  let writes = 0;
  const handler = createInquirySubmitHandler(async () => { writes++; return true; });
  assert.equal((await handler(submission({ botField: 'spam' }))).status, 201);
  assert.equal((await handler(nativeSubmission({ 'bot-field': 'spam' }))).status, 303);
  assert.equal(writes, 0);
});

test('invalid form values are rejected before saving', async t => {
  let writes = 0;
  const handler = createInquirySubmitHandler(async () => { writes++; return true; });
  const cases = {
    'missing submission id': { submissionId: '' },
    'invalid submission id': { submissionId: 'not-a-uuid' },
    'blank name': { fullName: '   ' },
    'long name': { fullName: 'x'.repeat(161) },
    'non-string name': { fullName: { name: 'QA' } },
    'invalid email': { email: 'not-an-email' },
    'long email': { email: `${'a'.repeat(250)}@b.invalid` },
    'unknown interest': { interest: 'Unrecognized selection' },
    'phone with letters': { phone: 'call-me-now' },
    'phone with no digits': { phone: '-------' },
    'oversize message': { message: 'x'.repeat(5001) },
    'null byte': { message: 'before\0after' },
  };
  for (const [name, values] of Object.entries(cases)) {
    await t.test(name, async () => {
      const response = await handler(submission({ ...valid, ...values }));
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, 'string');
    });
  }
  assert.equal(writes, 0);
});

test('bad envelopes, cross-origin requests, unsupported media, and excessive bytes never reach storage', async t => {
  let writes = 0;
  const handler = createInquirySubmitHandler(async () => { writes++; return true; });
  const cases = [
    ['malformed JSON', submission({}, { body: '{' }), 400],
    ['JSON array', submission([]), 400],
    ['JSON null', submission(null), 400],
    ['foreign origin', submission(valid, { headers: { origin: 'https://foreign.invalid' } }), 403],
    ['opaque origin', submission(valid, { headers: { origin: 'null' } }), 403],
    ['unsupported format', submission(valid, { headers: { 'content-type': 'text/plain' } }), 415],
    ['declared body too large', submission(valid, { headers: { 'content-length': '32769' } }), 413],
    ['actual multibyte body too large', submission(valid, { body: JSON.stringify({ extra: '😀'.repeat(9000) }) }), 413],
  ];
  for (const [name, req, status] of cases) {
    await t.test(name, async () => assert.equal((await handler(req)).status, status));
  }
  const missingOrigin = submission();
  missingOrigin.headers.delete('origin');
  assert.equal((await handler(missingOrigin)).status, 403);
  const method = await handler(new Request(`${origin}/.netlify/functions/submit-inquiry`));
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  assert.equal(writes, 0);
});

const listRequest = (query = '') => new Request(`${origin}/.netlify/functions/admin-inquiries${query}`);

test('unauthenticated and non-admin callers cannot read inquiries', async () => {
  let membershipChecks = 0;
  let reads = 0;
  const deps = {
    authenticate: async () => { throw Object.assign(new Error('invalid token detail'), { status: 401 }); },
    isAdmin: async () => { membershipChecks++; return false; },
    list: async () => { reads++; return { inquiries: [], total: 0 }; },
  };
  const anonymous = await createInquiryListHandler(deps)(listRequest());
  assert.equal(anonymous.status, 401);
  assert.equal(membershipChecks, 0);
  assert.equal(reads, 0);
  assert.deepEqual(await anonymous.json(), { error: 'Sign in required.' });
  deps.authenticate = async () => ({ id: 'authenticated-non-admin' });
  const ordinary = await createInquiryListHandler(deps)(listRequest());
  assert.equal(ordinary.status, 403);
  assert.equal(membershipChecks, 1);
  assert.equal(reads, 0);
});

test('authorized listing checks the verified user and returns paginated records and total', async () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: `qa-${index}`, full_name: `QA ${index}` }));
  const calls = [];
  const handler = createInquiryListHandler({
    authenticate: async () => { calls.push('authenticate'); return { id: 'verified-admin' }; },
    isAdmin: async id => { calls.push(['membership', id]); return true; },
    list: async (page, size) => {
      calls.push(['list', page, size]);
      return { inquiries: rows.slice((page - 1) * size, page * size), total: rows.length };
    },
  });
  const response = await handler(listRequest('?page=2&page_size=10000'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { inquiries: rows.slice(25), total: 30, page: 2, page_size: 25 });
  assert.deepEqual(calls, ['authenticate', ['membership', 'verified-admin'], ['list', 2, 25]]);
});

test('list validation and failures stay in this endpoint without exposing internal errors', async () => {
  let reads = 0;
  const deps = {
    authenticate: async () => ({ id: 'verified-admin' }),
    isAdmin: async () => true,
    list: async () => { reads++; throw new Error('private schema, connection password=secret'); },
  };
  const handler = createInquiryListHandler(deps);
  for (const page of ['0', '-1', '1.5', 'NaN', 'Infinity', '2e3', '9007199254740992']) {
    assert.equal((await handler(listRequest(`?page=${page}`))).status, 400);
  }
  assert.equal(reads, 0);
  const response = await handler(listRequest());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Inquiries could not be loaded. Please try again.' });
  assert.equal(reads, 1);
  const wrongMethod = await handler(new Request(`${origin}/.netlify/functions/admin-inquiries`, { method: 'POST' }));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
});
