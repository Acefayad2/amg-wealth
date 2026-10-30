import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../netlify/functions/amg-checkout.mts', import.meta.url), 'utf8');
const runnable = source
  .replace(/function json\(body: unknown, status = 200\)/, 'function json(body, status = 200)')
  .replace(/function cleanText\(value: unknown, maximum: number\)/, 'function cleanText(value, maximum)')
  .replace(/function validEmail\(value: string\)/, 'function validEmail(value)')
  .replace(/async function createCheckoutSession\(secret: string, body: URLSearchParams, idempotencyKey: string\)/, 'async function createCheckoutSession(secret, body, idempotencyKey)')
  .replace(/export default async \(request: Request\) =>/, 'const handler = async (request) =>')
  .replace(/export const config = [\s\S]*$/, 'export { handler };');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(runnable).toString('base64')}`;
const { handler } = await import(moduleUrl);

function setNetlifyEnv(values = {}) {
  globalThis.Netlify = { env: { get: (key) => values[key] || '' } };
}

test('reports whether Stripe is connected without exposing a key', async () => {
  setNetlifyEnv({ AMG_STRIPE_SECRET_KEY: 'rk_live_example' });
  const response = await handler(new Request('https://example.com/api/amg-checkout'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stripeConnected: true });
});

test('rejects an invoice that is not in the server-side catalog', async () => {
  setNetlifyEnv({ AMG_STRIPE_SECRET_KEY: 'rk_live_example' });
  const response = await handler(new Request('https://example.com/api/amg-checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Amina Cole', email: 'amina@example.com', invoiceId: 'not-a-real-invoice' })
  }));
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /invoice/i);
});

test('creates a fixed-price Stripe Checkout Session for the AMG invoice', async (t) => {
  setNetlifyEnv({ AMG_STRIPE_SECRET_KEY: 'rk_live_example', URL: 'https://anointedmoneygroup.com' });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  let stripeBody;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(options.method, 'POST');
    stripeBody = options.body;
    return new Response(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/example' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const response = await handler(new Request('https://anointedmoneygroup.com/api/amg-checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Amina Cole',
      email: 'amina@example.com',
      invoiceId: 'LP-AMG-20261027-01',
      amount: 1,
      requestId: '550e8400-e29b-41d4-a716-446655440000'
    })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { url: 'https://checkout.stripe.com/c/pay/example', sessionId: 'cs_test_123' });
  assert.equal(stripeBody.get('mode'), 'payment');
  assert.equal(stripeBody.get('line_items[0][price_data][unit_amount]'), '450000');
  assert.equal(stripeBody.get('metadata[invoice_id]'), 'LP-AMG-20261027-01');
  assert.equal(stripeBody.get('customer_email'), 'amina@example.com');
  assert.equal(stripeBody.get('phone_number_collection[enabled]'), 'true');
  assert.equal(stripeBody.get('success_url'), 'https://anointedmoneygroup.com/payment-success.html?session_id={CHECKOUT_SESSION_ID}');
});
