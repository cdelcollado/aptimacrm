import type { StorageError, StorageResult } from "@/server/adapters/storage/types";

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injected for tests so backoff does not slow the suite. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Exponential backoff with full jitter: delay in [0, min(max, base * 2^attempt)). */
export function backoffDelay(attempt: number, opts: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "random">): number {
  const ceiling = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
  return Math.floor((opts.random ?? Math.random)() * ceiling);
}

/** Retry only errors the adapter marked retryable (timeouts, 5xx, connection resets). */
export async function withRetry<T>(op: () => Promise<StorageResult<T>>, opts: RetryOptions): Promise<StorageResult<T>> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: StorageResult<T> | undefined;
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    last = await op();
    if (last.ok) return last;
    if (!last.error.retryable || attempt === opts.attempts - 1) return last;
    await sleep(backoffDelay(attempt, opts));
  }
  return last!;
}

export function fail(code: StorageError["code"], message: string, retryable: boolean): { ok: false; error: StorageError } {
  return { ok: false, error: { code, message, retryable } };
}
