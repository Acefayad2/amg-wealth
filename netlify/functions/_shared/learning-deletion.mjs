import { randomUUID } from 'node:crypto';
import { hash } from './learning-core.mjs';

const emailKey = email => 'resets/' + hash(email.normalize('NFKC').trim().toLowerCase());
const validId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const validGeneration = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export async function learningIdentity(store, user) {
  const reset = await store.get(emailKey(user.email), { type: 'json' });
  if (!reset) return { ...user, accountId: user.id, resetGeneration: false };
  if (reset.v !== 1 || !validGeneration(reset.generation)) throw new Error('Invalid learning reset');
  return { ...user, accountId: user.id, id: user.id + ':' + reset.generation, resetGeneration: true, deletionPending: reset.pending === true };
}

export async function purgeLearningNamespace(store, id) {
  if (!validId(id)) throw new Error('Invalid learner storage identity');
  const { blobs } = await store.list({ prefix: `users/${id}/` });
  for (let start = 0; start < blobs.length; start += 20) {
    await Promise.all(blobs.slice(start, start + 20).map(blob => store.delete(blob.key)));
  }
  await store.delete('learners/' + id);
}

// The caller holds the selected pipeline row's database lock. Retain a small,
// non-PII reset marker so stale browsers can never restore the erased namespace.
// Repeating a partially failed deletion resumes the same purge, not a new reset.
export async function eraseLearningHistory(store, { email, baseUserId, deletionId }) {
  if (!email) return;
  const key = emailKey(email);
  const current = await store.getWithMetadata(key, { type: 'json' });
  const previous = current?.data;
  if (previous && (previous.v !== 1 || !validGeneration(previous.generation))) throw new Error('Invalid learning reset');
  const ids = new Set([hash(baseUserId), ...(previous?.purgeIds || [])]);
  if (previous && previous.deletionId !== deletionId) ids.add(hash(baseUserId + ':' + previous.generation));
  if (![...ids].every(validId)) throw new Error('Invalid learner purge identity');
  const reset = { v: 1, generation: previous?.deletionId === deletionId ? previous.generation : randomUUID(), deletionId, purgeIds: [...ids], pending: true };
  const saved = await store.setJSON(key, reset, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
  if (!saved.modified) throw new Error('Learning history changed. Retry deletion.');
  for (const id of ids) await purgeLearningNamespace(store, id);
  const finished = await store.setJSON(key, { ...reset, pending: false }, { onlyIfMatch: saved.etag });
  if (!finished.modified) throw new Error('Learning history changed. Retry deletion.');
}

const changed = () => new Response(JSON.stringify({ error: 'account_changed' }), { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
export async function withLearningIdentity(store, baseUser, run) {
  const user = await learningIdentity(store, baseUser);
  if (user.deletionPending) return changed();
  let result, failure;
  try { result = await run(user); } catch (error) { failure = error; }
  const latest = await learningIdentity(store, baseUser);
  if (latest.id !== user.id || latest.deletionPending) {
    // A save that was already in flight when deletion began must clean up its
    // own old namespace. The current generation is a different storage prefix.
    await purgeLearningNamespace(store, hash(user.id));
    return changed();
  }
  if (failure) throw failure;
  return result;
}
