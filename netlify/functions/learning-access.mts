import type { Config } from '@netlify/functions';
import { accessCookie, accessSecret, GATE_COOKIE, GATE_TTL_SECONDS, issueGate, issueSession, normalizeProfile, readAccessCookie, SESSION_COOKIE, SESSION_TTL_SECONDS, validSharedCode, verifyAccessToken } from '../shared/access-session.ts';

const MAX_BODY_BYTES = 4096;
class AccessInputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new AccessInputError('json_required', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new AccessInputError('request_too_large', 413);
  const reader = request.body?.getReader(); if (!reader) throw new AccessInputError('invalid_request');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new AccessInputError('request_too_large', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!object(body)) throw new Error('Invalid body');
    return body;
  } catch (error) {
    if (error instanceof AccessInputError) throw error;
    throw new AccessInputError('invalid_request');
  } finally { reader.releaseLock(); }
}

export default async function access(request: Request): Promise<Response> {
  try {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
    if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'invalid_origin' }, 403);
    const secret = accessSecret();
    if (request.method === 'GET') {
      const session = await verifyAccessToken(readAccessCookie(request, SESSION_COOKIE), 'session', secret);
      if (session?.purpose === 'session') return json({ stage: 'ready', user: { id: session.id, name: session.name, email: session.email } });
      const gate = await verifyAccessToken(readAccessCookie(request, GATE_COOKIE), 'gate', secret);
      return json({ stage: gate ? 'profile' : 'code' });
    }
    const body = await bodyOf(request);
    if (body.action === 'logout' && exactKeys(body, ['action'])) return json({ stage: 'code' }, 200, [accessCookie(GATE_COOKIE, '', 0), accessCookie(SESSION_COOKIE, '', 0)]);
    if (body.action === 'code' && exactKeys(body, ['action', 'code'])) {
      const expected = Netlify.env.get('AMG_REGISTRATION_CODE');
      if (!expected) return json({ error: 'access_service_unavailable' }, 503);
      if (!await validSharedCode(body.code, expected, secret)) return json({ error: 'code_invalid' }, 401);
      return json({ stage: 'profile' }, 200, [accessCookie(GATE_COOKIE, await issueGate(secret), GATE_TTL_SECONDS), accessCookie(SESSION_COOKIE, '', 0)]);
    }
    if (body.action === 'start' && exactKeys(body, ['action', 'name', 'email'])) {
      if (!await verifyAccessToken(readAccessCookie(request, GATE_COOKIE), 'gate', secret)) return json({ error: 'gate_required' }, 403);
      const profile = normalizeProfile(body.name, body.email);
      if (!profile) return json({ error: 'invalid_profile' }, 400);
      const token = await issueSession(profile, secret);
      const session = await verifyAccessToken(token, 'session', secret);
      if (!session || session.purpose !== 'session') throw new Error('Session issue failed');
      return json({ stage: 'ready', user: { id: session.id, ...profile } }, 200, [accessCookie(SESSION_COOKIE, token, SESSION_TTL_SECONDS), accessCookie(GATE_COOKIE, '', 0)]);
    }
    return json({ error: 'invalid_request' }, 400);
  } catch (error) {
    if (error instanceof AccessInputError) return json({ error: error.message }, error.status);
    return json({ error: 'access_service_unavailable' }, 503);
  }
}

export const config: Config = {
  path: '/api/access',
  method: ['GET', 'POST'],
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
