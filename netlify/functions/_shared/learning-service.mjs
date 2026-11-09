import { randomUUID } from 'node:crypto';
import { allowedKeys, buildReport, hash, InputError, lessonByKey, reportingSignature, userPrefix, validateValue } from './learning-core.mjs';

export const MAX_BODY_BYTES = 1048576;
export const REPORT_INTERVAL_MS = 120000;
const REPORT_EVENT_INTERVAL_MS = 30000;
const REPORT_TIMEOUT_MS = 12000;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, X-AMG-User', 'X-Content-Type-Options': 'nosniff' } });
const publicRecord = record => record ? { value: record.value, revision: record.revision } : { value: null, revision: 0 };
const conditional = entry => entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new InputError('JSON content type required', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new InputError('Request too large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('Missing JSON body');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new InputError('Request too large', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!isObject(value)) throw new InputError('Expected a JSON object');
    return value;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Invalid JSON body');
  } finally { reader.releaseLock(); }
}

async function readRecords(store, prefix) {
  const records = {};
  for (let start = 0; start < allowedKeys.length; start += 10) {
    await Promise.all(allowedKeys.slice(start, start + 10).map(async key => {
      const entry = await store.getWithMetadata(prefix + 'records/' + key, { type: 'json' });
      if (entry) records[key] = entry.data;
    }));
  }
  return records;
}

function reportFingerprint(user, records) {
  return hash({ id: user.id, name: user.name || '', email: user.email, revisions: allowedKeys.map(key => [key, records[key]?.revision || 0]) });
}
function reportStatus(entry, fingerprint, configured, now) {
  const state = entry?.data;
  return { status: !configured ? 'not_configured' : state?.fingerprint === fingerprint && state?.status === 'synced' ? 'synced' : 'pending', lastSyncedAt: state?.lastSyncedAt || null, retryAfterMs: Math.max(0, (state?.lastAttemptAt || 0) + REPORT_INTERVAL_MS - now) };
}
function configuredURL(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'script.google.com' && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}

// Dependencies make every authorization, CAS and reporting-failure path testable
// without contacting production Blobs or the company's spreadsheet.
export function createLearningHandler({ getUser, getStore, appsScriptURL = () => '', getToken = request => {
  const match = /(?:^|;\s*)__Host-amg_session=([^;]+)/.exec(request.headers.get('cookie') || '');
  try { return match ? decodeURIComponent(match[1]) : null; } catch { return null; }
}, fetchImpl = fetch, now = Date.now, reportTimeoutMs = REPORT_TIMEOUT_MS }) {
  async function reporting(store, prefix, user, records, request, attemptSync) {
    const key = prefix + 'reporting';
    const entry = await store.getWithMetadata(key, { type: 'json' });
    const timestamp = now(), fingerprint = reportFingerprint(user, records);
    const url = configuredURL(appsScriptURL());
    const status = reportStatus(entry, fingerprint, Boolean(url), timestamp);
    const interval = attemptSync === 'event' ? REPORT_EVENT_INTERVAL_MS : REPORT_INTERVAL_MS;
    const recentlyAttempted = entry && timestamp < entry.data.lastAttemptAt + interval;
    if (!attemptSync || !url || status.status === 'synced' || recentlyAttempted || (entry?.data.leaseUntil || 0) > timestamp) return status;
    const token = getToken(request);
    if (typeof token !== 'string' || !token.length || token.length > 16384) return status;
    const leaseId = randomUUID();
    const pending = { status: 'pending', lastSyncedAt: entry?.data.lastSyncedAt || null, lastAttemptAt: timestamp, fingerprint: entry?.data.fingerprint || null, leaseId, leaseUntil: timestamp + reportTimeoutMs + 5000 };
    const claimed = await store.setJSON(key, pending, conditional(entry));
    if (!claimed.modified) return reportStatus(await store.getWithMetadata(key, { type: 'json' }), fingerprint, true, now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), reportTimeoutMs);
    let accepted = false;
    try {
      // The legacy exam endpoint blindly appends POST bodies to its historical
      // sheet. Authenticate the reporting protocol with a harmless GET before
      // sending any token or learner payload. Never POST to an old deployment.
      const probe = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'follow' });
      const probeText = await probe.text();
      const readiness = probe.ok && probeText.length <= 4096 ? JSON.parse(probeText) : null;
      if (!isObject(readiness) || Object.keys(readiness).length !== 3 || readiness.ok !== true || readiness.service !== 'AMG Learning reporting' || readiness.version !== 2) throw new Error('Reporting protocol unavailable');
      // The script authenticates this token, then fetches ?report=1 itself. It must
      // never accept a client-supplied summary, score or completion declaration.
      const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'course_sync', sessionToken: token }), signal: controller.signal, redirect: 'follow' });
      if (response.ok) {
        const raw = await response.text();
        if (raw.length <= 4096) {
          const ack = JSON.parse(raw);
          accepted = ack?.ok === true && typeof ack.syncedAt === 'string' && Number.isFinite(Date.parse(ack.syncedAt));
        }
      }
    } catch { /* Progress is already committed. A failed sync stays explicitly pending. */ }
    finally { clearTimeout(timeout); }
    const final = { ...pending, status: accepted ? 'synced' : 'pending', lastSyncedAt: accepted ? new Date(now()).toISOString() : pending.lastSyncedAt, fingerprint: accepted ? fingerprint : pending.fingerprint, leaseUntil: 0 };
    const saved = await store.setJSON(key, final, { onlyIfMatch: claimed.etag });
    const latest = await readRecords(store, prefix);
    return reportStatus(saved.modified ? { data: final } : await store.getWithMetadata(key, { type: 'json' }), reportFingerprint(user, latest), true, now());
  }

  return async function learning(request) {
    try {
      if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405);
      const authenticated = await getUser(request);
      if (!authenticated?.id) return json({ error: 'authentication_required' }, 401);
      if (!authenticated.email || authenticated.accessGranted !== true) return json({ error: 'course_access_required' }, 403);
      const user = { id: authenticated.id, email: authenticated.email, name: typeof authenticated.name === 'string' ? authenticated.name.slice(0, 150) : '' };
      if (request.method === 'POST') {
        if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'invalid_origin' }, 403);
        if (request.headers.get('X-AMG-User') !== user.id) return json({ error: 'account_changed' }, 403);
      }
      const store = getStore(), prefix = userPrefix(user.id);
      if (request.method === 'GET') {
        const records = await readRecords(store, prefix);
        if (new URL(request.url).searchParams.get('report') === '1') return json(buildReport(user, records));
        let state;
        try { state = await reporting(store, prefix, user, records, request, 'login'); }
        catch { state = { status: 'pending', lastSyncedAt: null, retryAfterMs: REPORT_INTERVAL_MS }; }
        return json({ user, records: Object.fromEntries(Object.entries(records).map(([key, record]) => [key, publicRecord(record)])), reporting: state });
      }
      const body = await readBody(request);
      if (body.action === 'sync-report' && Object.keys(body).length === 1) {
        const records = await readRecords(store, prefix);
        return json({ reporting: await reporting(store, prefix, user, records, request, 'retry') });
      }
      if (Object.keys(body).length !== 4 || !['key', 'value', 'revision', 'mutationId'].every(key => Object.prototype.hasOwnProperty.call(body, key))) throw new InputError('Invalid progress envelope');
      const { key, value, revision, mutationId } = body;
      if (!allowedKeys.includes(key)) throw new InputError('Unknown progress key');
      if (!Number.isSafeInteger(revision) || revision < 0) throw new InputError('Invalid revision');
      if (typeof mutationId !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(mutationId)) throw new InputError('Invalid mutation ID');
      const storageKey = prefix + 'records/' + key;
      const entry = await store.getWithMetadata(storageKey, { type: 'json' });
      // Validate structure before recursive canonical hashing; idempotent old
      // snapshots remain valid even when newer submitted attempts now exist.
      validateValue(key, value, now());
      const digest = hash({ value, revision });
      const retry = entry?.data.mutations?.find(mutation => mutation.id === mutationId);
      if (retry) {
        if (retry.hash !== digest) return json({ error: 'conflict', record: publicRecord(entry.data) }, 409);
        const records = await readRecords(store, prefix);
        return json({ record: publicRecord(entry.data), idempotent: true, reporting: await reporting(store, prefix, user, records, request, false) });
      }
      if (revision !== (entry?.data.revision || 0)) return json({ error: 'conflict', record: publicRecord(entry?.data) }, 409);
      validateValue(key, value, now(), entry?.data.value);
      const changed = reportingSignature(key, value) !== reportingSignature(key, entry?.data.value);
      const importantEvent = lessonByKey.has(key)
        ? !entry || (value.complete && !entry.data.value.complete)
        : changed;
      const updatedAt = new Date(now()).toISOString();
      const record = { value, revision: revision + 1, updatedAt, reportRevision: (entry?.data.reportRevision || 0) + (changed ? 1 : 0), firstCompletedAt: entry?.data.firstCompletedAt || (lessonByKey.has(key) && value.complete ? updatedAt : null), mutations: [...(entry?.data.mutations || []), { id: mutationId, hash: digest, revision: revision + 1 }].slice(-64) };
      const result = await store.setJSON(storageKey, record, conditional(entry));
      if (!result.modified) {
        const current = await store.getWithMetadata(storageKey, { type: 'json' });
        const matchingRetry = current?.data.mutations?.find(mutation => mutation.id === mutationId && mutation.hash === digest);
        if (matchingRetry) {
          const records = await readRecords(store, prefix);
          return json({ record: publicRecord(current.data), idempotent: true, reporting: await reporting(store, prefix, user, records, request, false) });
        }
        return json({ error: 'conflict', record: publicRecord(current?.data) }, 409);
      }
      const records = await readRecords(store, prefix);
      let state;
      try { state = await reporting(store, prefix, user, records, request, importantEvent ? 'event' : false); }
      catch { state = { status: 'pending', lastSyncedAt: null, retryAfterMs: REPORT_INTERVAL_MS }; }
      return json({ record: publicRecord(record), reporting: state });
    } catch (error) {
      if (error instanceof InputError) return json({ error: 'invalid_progress', message: error.message }, error.status);
      return json({ error: 'progress_service_unavailable' }, 503);
    }
  };
}
