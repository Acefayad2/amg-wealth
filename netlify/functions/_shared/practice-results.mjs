const headers = { 'cache-control': 'private, no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
const invalid = (message, status = 400) => Object.assign(new Error(message), { status, public: true });
export function validateResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Invalid result.');
  if (typeof input.attemptId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.attemptId)) throw invalid('Invalid attempt ID.');
  const field = (key, max) => { const value = input[key]; if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw invalid(`Invalid ${key}.`); return value.trim(); };
  const name = field('name', 160), email = field('email', 254).toLowerCase(), examType = field('examType', 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('Invalid email.');
  if (examType !== 'Accident & Health or Sickness Producer' || input.total !== 90) throw invalid('Unsupported practice exam.');
  const { score, total, wrong, skipped } = input;
  if (![score, total, wrong, skipped].every(Number.isSafeInteger) || total < 1 || total > 1000 || score < 0 || wrong < 0 || skipped < 0 || score + wrong + skipped !== total) throw invalid('Invalid result counts.');
  if (typeof input.earlyFail !== 'boolean') throw invalid('Invalid completion state.');
  return { id: input.attemptId.toLowerCase(), name, email, examType, score, total, wrong, skipped, earlyFail: input.earlyFail, percentage: Math.round(score / total * 100), passed: !input.earlyFail && score / total >= 0.7 };
}
export function createPracticeSubmitHandler(save) {
  return async request => {
    try {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      if (request.headers.get('origin') !== new URL(request.url).origin) throw invalid('Submit results from the AMG website.', 403);
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw invalid('JSON required.', 415);
      if (Number(request.headers.get('content-length')) > 8192) throw invalid('Result too large.', 413);
      const reader = request.body?.getReader(); if (!reader) throw invalid('Missing result.');
      const chunks = []; let size = 0;
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) { await reader.cancel(); throw invalid('Result too large.', 413); } chunks.push(value); } } finally { reader.releaseLock(); }
      let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid('Invalid JSON.'); }
      const record = validateResult(input);
      if (!await save(record)) throw invalid('Attempt ID already belongs to a different result.', 409);
      return json({ ok: true, id: record.id }, 201);
    } catch (error) { return json({ error: error.public ? error.message : 'Your result could not be saved. Please retry.' }, error.public ? error.status : 503); }
  };
}
