export function verifyStorageConnection(
  query: () => Promise<unknown>,
  timeoutMs?: number,
): Promise<boolean>;
