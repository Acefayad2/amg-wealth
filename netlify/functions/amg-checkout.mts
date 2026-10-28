const STRIPE_API = 'https://api.stripe.com/v1';

const responseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : '';
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function createCheckoutSession(secret: string, body: URLSearchParams, idempotencyKey: string) {
  const response = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': idempotencyKey
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Stripe could not start checkout.');
  return data;
}

export default async (request: Request) => {
  try {
    const stripeSecret = Netlify.env.get('AMG_STRIPE_SECRET_KEY') || '';

    if (request.method === 'GET') return json({ stripeConnected: Boolean(stripeSecret) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!stripeSecret) return json({ error: 'AMG secure checkout is being connected. Please try again shortly.' }, 503);

    const payload = await request.json().catch(() => ({}));
    const name = cleanText(payload.name, 100);
    const email = cleanText(payload.email, 160).toLowerCase();
    const description = cleanText(payload.description, 120);
    const reference = cleanText(payload.reference, 80);
    const amount = Number(payload.amount);
    const amountInCents = Math.round(amount * 100);
    const requestId = /^[a-f0-9-]{36}$/i.test(payload.requestId || '') ? payload.requestId : crypto.randomUUID();

    if (!name) return json({ error: 'Enter your full name.' }, 400);
    if (!validEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
    if (!description) return json({ error: 'Tell us what this payment is for.' }, 400);
    if (!Number.isFinite(amount) || amountInCents < 100 || amountInCents > 5_000_000) {
      return json({ error: 'Enter an amount between $1 and $50,000.' }, 400);
    }

    const origin = new URL(request.url).origin;
    const siteUrl = (Netlify.env.get('URL') || origin || 'https://anointedmoneygroup.com').replace(/\/$/, '');
    const paymentLabel = `AMG - ${description}`.slice(0, 127);
    const paymentDescription = reference ? `Reference: ${reference}` : `Payment from ${name}`;
    const metadata = {
      payer_name: name,
      payment_reference: reference || 'none',
      request_id: requestId
    };

    const body = new URLSearchParams({
      mode: 'payment',
      success_url: `${siteUrl}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/pay.html?canceled=1`,
      customer_email: email,
      billing_address_collection: 'auto',
      'phone_number_collection[enabled]': 'true',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountInCents),
      'line_items[0][price_data][product_data][name]': paymentLabel,
      'line_items[0][price_data][product_data][description]': paymentDescription.slice(0, 500),
      'line_items[0][quantity]': '1',
      'payment_intent_data[description]': `${name}: ${description}`.slice(0, 500),
      'payment_intent_data[metadata][payer_name]': metadata.payer_name,
      'payment_intent_data[metadata][payment_reference]': metadata.payment_reference,
      'payment_intent_data[metadata][request_id]': metadata.request_id,
      'metadata[payer_name]': metadata.payer_name,
      'metadata[payment_reference]': metadata.payment_reference,
      'metadata[request_id]': metadata.request_id,
      'custom_text[submit][message]': 'Your payment is processed securely by Stripe.'
    });

    const session = await createCheckoutSession(stripeSecret, body, `${requestId}-amg-checkout`);
    return json({ url: session.url, sessionId: session.id });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Checkout could not be started.' }, 500);
  }
};

export const config = {
  path: '/api/amg-checkout',
  method: ['GET', 'POST'],
  rateLimit: { action: 'rate_limit', windowLimit: 20, windowSize: 60, aggregateBy: ['domain', 'ip'] }
};
