import { randomUUID } from 'node:crypto';

export type Inquiry = { id: string; fullName: string; email: string; phone: string; interest: string; message: string };
const interests = new Set(['Wealth Creation', 'Asset Protection', 'Retirement Planning', 'Financial Education', 'Generational Legacy', 'The Full Blueprint']);
const responseHeaders = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: responseHeaders });
const invalid = (message: string, status = 400) => Object.assign(new Error(message), { status, public: true });

function field(value: unknown, name: string, max: number, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.includes('\0')) throw invalid(`${name} is invalid.`);
  const clean = value.trim();
  if (required && !clean) throw invalid(`${name} is required.`);
  if (clean.length > max) throw invalid(`${name} must be ${max} characters or fewer.`);
  return clean;
}

export function createInquirySubmitHandler(save: (inquiry: Inquiry) => Promise<boolean>) {
  return async (req: Request) => {
    const contentType = req.headers.get('content-type')?.split(';')[0].trim();
    const nativeForm = contentType === 'application/x-www-form-urlencoded';
    const success = () => nativeForm
      ? new Response(null, { status: 303, headers: { location: '/thank-you.html', 'cache-control': 'no-store' } })
      : json({ ok: true }, 201);
    try {
      if (req.method !== 'POST') return new Response(null, { status: 405, headers: { ...responseHeaders, allow: 'POST' } });
      if (req.headers.get('origin') !== new URL(req.url).origin) throw invalid('Please submit the form from the AMG website.', 403);
      if (!nativeForm && contentType !== 'application/json') throw invalid('Unsupported submission format.', 415);
      if (Number(req.headers.get('content-length')) > 32768) throw invalid('Your inquiry is too long.', 413);
      const text = await req.text();
      if (Buffer.byteLength(text, 'utf8') > 32768) throw invalid('Your inquiry is too long.', 413);
      let input: Record<string, unknown>;
      try {
        input = nativeForm ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text);
        if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error();
      } catch { throw invalid('Please check your inquiry and try again.'); }
      if (input.botField || input['bot-field']) return success();
      const id = input.submissionId || (nativeForm ? randomUUID() : '');
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw invalid('Please reload the form and try again.');
      const inquiry: Inquiry = {
        id,
        fullName: field(input.fullName ?? input['full-name'], 'Full name', 160, true),
        email: field(input.email, 'Email', 254, true).toLowerCase(),
        phone: field(input.phone, 'Phone', 40),
        interest: field(input.interest, 'Interest', 80, true),
        message: field(input.message ?? input.goals, 'Message', 5000),
      };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)) throw invalid('Enter a valid email address.');
      if (!interests.has(inquiry.interest)) throw invalid('Choose one of the listed interests.');
      if (inquiry.phone && (!/^[+\d() .-]{7,40}$/.test(inquiry.phone) || !/^\d{7,15}$/.test(inquiry.phone.replace(/\D/g, '')))) throw invalid('Enter a valid phone number.');
      if (!await save(inquiry)) throw invalid('This submission has already been used. Reload the form before sending a different inquiry.', 409);
      return success();
    } catch (error) {
      const known = error as { public?: boolean; status?: number; message?: string };
      const status = known.public ? known.status || 400 : 503;
      const message = known.public ? known.message! : 'Your inquiry could not be saved. Please try again.';
      if (!nativeForm) return json({ error: message }, status);
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AMG inquiry</title><main><h1>Your inquiry was not submitted</h1><p>${message}</p><p>Use your browser’s Back button to return to the form and try again.</p><a href="/#contact">Return to AMG</a></main></html>`, { status, headers: { ...responseHeaders, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'" } });
    }
  };
}

export function createInquiryListHandler(deps: {
  authenticate: (req: Request) => Promise<{ id: string }>;
  isAdmin: (id: string) => Promise<boolean>;
  list: (page: number, pageSize: number) => Promise<{ inquiries: unknown[]; total: number }>;
}) {
  return async (req: Request) => {
    if (req.method !== 'GET') return new Response(null, { status: 405, headers: { ...responseHeaders, allow: 'GET' } });
    try {
      const user = await deps.authenticate(req);
      if (!await deps.isAdmin(user.id)) return json({ error: 'AMG admin access required.' }, 403);
      const raw = new URL(req.url).searchParams.get('page') || '1';
      const page = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000) return json({ error: 'Page is invalid.' }, 400);
      const result = await deps.list(page, 25);
      return json({ ...result, page, page_size: 25 });
    } catch (error) {
      if ((error as { status?: number }).status === 401) return json({ error: 'Sign in required.' }, 401);
      return json({ error: 'Inquiries could not be loaded. Please try again.' }, 503);
    }
  };
}
