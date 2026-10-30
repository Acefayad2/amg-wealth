const DEFAULT_TIMEOUT_MS = 3500;

export async function verifyStorageConnection(query, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(query),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("CRM storage verification timed out.")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
