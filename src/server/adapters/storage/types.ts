/**
 * Object storage contract. Domain code depends only on this. Implementations never throw raw
 * SDK errors; they return a Result with a normalized code so retries and messages are uniform.
 */
export type StorageErrorCode = "timeout" | "denied" | "not_found" | "unavailable" | "invalid";

export interface StorageError {
  code: StorageErrorCode;
  /** Redacted, human-readable. Never contains credentials or full object contents. */
  message: string;
  retryable: boolean;
}

export type StorageResult<T> = { ok: true; value: T } | { ok: false; error: StorageError };

export interface ObjectStorage {
  readonly driver: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<StorageResult<{ key: string; sha256: string }>>;
  get(key: string): Promise<StorageResult<Buffer>>;
  delete(key: string): Promise<StorageResult<void>>;
  /** Liveness probe for /api/health. */
  ping(): Promise<StorageResult<{ latencyMs: number }>>;
}

/** Keys are server-generated; reject anything that could escape the prefix. */
export function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9/_\-.]{1,256}$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error(`unsafe storage key rejected`);
  }
}
