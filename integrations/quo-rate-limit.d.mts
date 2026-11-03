export interface QuoRequestGateOptions {
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
  max429Retries?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export type QuoRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createQuoRequestGate(options?: QuoRequestGateOptions): QuoRequest;
export const quoRequest: QuoRequest;
