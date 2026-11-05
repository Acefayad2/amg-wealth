import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/inquiry-form.js', import.meta.url), 'utf8');

function setup(fetchImpl) {
  let handler;
  let pageshow;
  let nextId = 0;
  const calls = [];
  const redirects = [];
  const fields = {
    'full-name': 'AMG Test Inquiry', email: 'test@example.test', phone: '(202) 555-0100',
    interest: 'Financial Education', goals: 'Synthetic test inquiry.', 'bot-field': '',
  };
  const button = { disabled: false };
  const label = { textContent: 'Request My Consultation' };
  const error = { hidden: true, textContent: '', focus() { this.focused = true; } };
  const status = { textContent: '' };
  const id = { value: '' };
  const attributes = {};
  const form = {
    elements: { namedItem() { return id; } },
    querySelector(selector) { return selector === 'button[type="submit"]' ? button : label; },
    addEventListener(name, callback) { if (name === 'submit') handler = callback; },
    setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
  };
  const context = {
    document: {
      querySelector() { return form; },
      getElementById(name) { return name === 'inquiry-error' ? error : status; },
    },
    window: {
      location: { assign(url) { redirects.push(url); } },
      addEventListener(name, callback) { if (name === 'pageshow') pageshow = callback; },
    },
    crypto: { randomUUID() { return `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`; } },
    FormData: class { get(name) { return fields[name]; } },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls.push({ url, ...options, payload: JSON.parse(options.body) });
      return fetchImpl(calls.length, options);
    },
  };
  vm.runInNewContext(source, context, { filename: 'assets/inquiry-form.js' });
  return { fields, button, label, error, status, id, attributes, calls, redirects,
    submit: () => handler({ preventDefault() {} }), restore: () => pageshow({ persisted: true }) };
}

const ok = { ok: true, status: 201, json: async () => ({ ok: true }) };

test('confirmed inquiry posts only to the same-origin endpoint then opens thank-you', async () => {
  const app = setup(async () => ok);
  await app.submit();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].url, '/.netlify/functions/submit-inquiry');
  assert.equal(app.calls[0].credentials, 'same-origin');
  assert.deepEqual(app.calls[0].payload, {
    fullName: app.fields['full-name'], email: app.fields.email, phone: app.fields.phone,
    interest: app.fields.interest, message: app.fields.goals, botField: '', submissionId: app.id.value,
  });
  assert.deepEqual(app.redirects, ['/thank-you.html']);
  assert.equal(app.button.disabled, true);
});

test('failed or unconfirmed responses preserve details, expose an error, and never redirect', async () => {
  for (const response of [
    { ok: false, status: 503, json: async () => ({ error: 'Internal database details' }) },
    { ok: true, status: 200, json: async () => ({ ok: false }) },
    { ok: true, status: 200, json: async () => { throw new SyntaxError('bad JSON'); } },
  ]) {
    const app = setup(async () => response);
    await app.submit();
    assert.deepEqual(app.redirects, []);
    assert.equal(app.button.disabled, false);
    assert.equal(app.error.hidden, false);
    assert.equal(app.error.focused, true);
    assert.match(app.error.textContent, /couldn't confirm/);
    assert.equal(app.fields.goals, 'Synthetic test inquiry.');
    assert.equal(app.attributes['aria-busy'], undefined);
  }
});

test('network retries reuse the same submission identifier until content changes', async () => {
  const app = setup(async () => { throw new TypeError('Failed to fetch'); });
  await app.submit();
  await app.submit();
  assert.equal(app.calls[0].payload.submissionId, app.calls[1].payload.submissionId);
  app.fields.goals = 'Updated inquiry after error.';
  await app.submit();
  assert.notEqual(app.calls[1].payload.submissionId, app.calls[2].payload.submissionId);
  assert.deepEqual(app.redirects, []);
});

test('repeated submit is ignored while the first request is pending', async () => {
  let resolve;
  const app = setup(() => new Promise(yes => { resolve = yes; }));
  const first = app.submit();
  assert.equal(app.button.disabled, true);
  assert.equal(app.attributes['aria-busy'], 'true');
  await app.submit();
  assert.equal(app.calls.length, 1);
  resolve(ok);
  await first;
  await app.submit();
  assert.equal(app.calls.length, 1);
});

test('validation errors appear as text without losing the submitted values', async () => {
  const app = setup(async () => ({ ok: false, status: 422, json: async () => ({ error: 'Please enter a valid email address.' }) }));
  await app.submit();
  assert.equal(app.error.textContent, 'Please enter a valid email address.');
  assert.equal(app.fields.email, 'test@example.test');
  assert.deepEqual(app.redirects, []);
});

test('returning from confirmation via browser back enables a fresh inquiry', async () => {
  const app = setup(async () => ok);
  await app.submit();
  const oldId = app.id.value;
  app.restore();
  assert.equal(app.button.disabled, false);
  assert.notEqual(app.id.value, oldId);
  await app.submit();
  assert.equal(app.calls.length, 2);
});
