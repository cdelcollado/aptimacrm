/**
 * Fixed-window in-process rate limiter. Adequate for a single instance. Multi-instance
 * deployments need a shared store (documented in README "Known limitations").
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, opts: { max: number; windowMs: number }, now = Date.now()): RateLimitResult {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + opts.windowMs });
    pruneIfLarge(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= opts.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Check the window without counting. Used before an attempt so only failures use up the budget. */
export function peekRateLimit(key: string, opts: { max: number }, now = Date.now()): RateLimitResult {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
  if (current.count >= opts.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Clear a key after success, so a user who signs in correctly is not locked out by old failures. */
export function resetRateLimit(key: string): void {
  windows.delete(key);
}

/** Test helper. */
export function resetRateLimits(): void {
  windows.clear();
}

function pruneIfLarge(now: number): void {
  if (windows.size < 10_000) return;
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
}
