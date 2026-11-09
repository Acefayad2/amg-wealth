export const GATE_COOKIE = '__Host-amg_gate';
export const SESSION_COOKIE = '__Host-amg_session';
export const GATE_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_TOKEN_LENGTH = 4096;
export type CourseUser = { id: string; name: string; email: string; accessGranted: true };
type Gate = { v: 1; purpose: 'gate'; iat: number; exp: number; nonce: string };
type Session = { v: 1; purpose: 'session'; iat: number; exp: number; id: string; name: string; email: string };
type Payload = Gate | Session;
const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function accessSecret(): string {
  const secret = Netlify.env.get('AMG_SESSION_SECRET');
  if (typeof secret !== 'string' || encoder.encode(secret).length < 32) throw new Error('Access session configuration unavailable');
  return secret;
}
function base64url(bytes: Uint8Array): string {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decode64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error('Non-canonical encoding');
  return bytes;
}
async function keyFor(secret: string) {
  if (encoder.encode(secret).length < 32) throw new Error('Access session configuration unavailable');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function mac(secret: string, value: string) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(value)));
}
export function readAccessCookie(request: Request, name: string): string | null {
  const values = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='));
  // Reject ambiguous duplicate cookies rather than selecting an untrusted copy.
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return value && value.length <= MAX_TOKEN_LENGTH && /^[A-Za-z0-9_.-]+$/.test(value) ? value : null;
}
export function normalizeProfile(name: unknown, email: unknown): { name: string; email: string } | null {
  if (typeof name !== 'string' || typeof email !== 'string' || name.length > 240 || email.length > 320) return null;
  if (/[\u0000-\u001f\u007f]/.test(name + email)) return null;
  const normalizedName = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const normalizedEmail = email.normalize('NFKC').trim().toLowerCase();
  if (!normalizedName || normalizedName.length > 120 || normalizedEmail.length > 254) return null;
  if (!/^[^\s@<>(),;:\\"\[\]]+@[^\s@<>(),;:\\"\[\]]+\.[^\s@<>(),;:\\"\[\]]+$/.test(normalizedEmail)) return null;
  const [local, domain] = normalizedEmail.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.includes('..')) return null;
  if (!domain.split('.').every(label => /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label) && label.length <= 63)) return null;
  return { name: normalizedName, email: normalizedEmail };
}
export async function learnerId(email: string, secret = accessSecret()): Promise<string> {
  // Keep this secret stable: the same normalized email resumes the same records.
  return Array.from(await mac(secret, 'amg-learner-v1:' + email), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function sign(payload: Payload, secret: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  return body + '.' + base64url(await mac(secret, 'amg-access-v1:' + body));
}
export async function issueGate(secret = accessSecret(), now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return sign({ v: 1, purpose: 'gate', iat, exp: iat + GATE_TTL_SECONDS, nonce: crypto.randomUUID() }, secret);
}
export async function issueSession(profile: { name: string; email: string }, secret = accessSecret(), now = Date.now()): Promise<string> {
  const normalized = normalizeProfile(profile.name, profile.email);
  if (!normalized) throw new Error('Invalid profile');
  const iat = Math.floor(now / 1000);
  return sign({ v: 1, purpose: 'session', iat, exp: iat + SESSION_TTL_SECONDS, id: await learnerId(normalized.email, secret), ...normalized }, secret);
}
export async function verifyAccessToken(token: string | null, purpose: 'gate' | 'session', secret = accessSecret(), now = Date.now()): Promise<Payload | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  try {
    const parts = token.split('.'); if (parts.length !== 2) return null;
    const signature = decode64url(parts[1]); if (signature.length !== 32) return null;
    if (!await crypto.subtle.verify('HMAC', await keyFor(secret), signature, encoder.encode('amg-access-v1:' + parts[0]))) return null;
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode64url(parts[0])));
    if (!object(payload) || payload.v !== 1 || payload.purpose !== purpose || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) return null;
    const iat = payload.iat as number, exp = payload.exp as number, seconds = Math.floor(now / 1000);
    if (iat > seconds + 30 || iat < 0 || exp <= seconds || exp - iat !== (purpose === 'gate' ? GATE_TTL_SECONDS : SESSION_TTL_SECONDS)) return null;
    if (purpose === 'gate') {
      if (Object.keys(payload).length !== 5 || typeof payload.nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(payload.nonce)) return null;
    } else {
      if (Object.keys(payload).length !== 7) return null;
      const profile = normalizeProfile(payload.name, payload.email);
      if (!profile || profile.name !== payload.name || profile.email !== payload.email || payload.id !== await learnerId(profile.email, secret)) return null;
    }
    return payload as Payload;
  } catch { return null; }
}
export async function validSharedCode(value: unknown, expected: string, secret = accessSecret()): Promise<boolean> {
  if (typeof value !== 'string' || value.length > 256 || !expected || expected.length > 256) return false;
  return crypto.subtle.verify('HMAC', await keyFor(secret), await mac(secret, 'amg-code-v1:' + expected), encoder.encode('amg-code-v1:' + value));
}
export function accessCookie(name: string, value: string, maxAge: number): string {
  if (![GATE_COOKIE, SESSION_COOKIE].includes(name)) throw new Error('Unknown access cookie');
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
