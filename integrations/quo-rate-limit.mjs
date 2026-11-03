const DEFAULT_MIN_INTERVAL_MS = 125;
const DEFAULT_MAX_429_RETRIES = 3;

function retryDelay(response, attempt, random) {
  const retryAfter = response.headers.get("retry-after");
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  return (1_000 * (2 ** attempt)) + Math.floor(random() * 250);
}

export function createQuoRequestGate({
  fetchImpl = fetch,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  max429Retries = DEFAULT_MAX_429_RETRIES,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random = Math.random,
} = {}) {
  let turn = Promise.resolve();
  let nextRequestAt = 0;
  let blockedUntil = 0;

  async function runAtTurn(operation) {
    let release;
    const previous = turn;
    turn = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      const delay = Math.max(0, nextRequestAt - now(), blockedUntil - now());
      if (delay > 0) await sleep(delay);
      nextRequestAt = now() + minIntervalMs;
      return operation();
    } finally {
      release();
    }
  }

  return async function quoRequest(input, init) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await runAtTurn(() => fetchImpl(input, init));
      if (response.status !== 429 || attempt >= max429Retries) return response;

      // An explicit 429 means Quo rejected the request before accepting its
      // effect, so this is the only POST response that is safe to retry.
      blockedUntil = Math.max(blockedUntil, now() + retryDelay(response, attempt, random));
    }
  };
}

export const quoRequest = createQuoRequestGate();
