import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { assertSafeKey, type ObjectStorage, type StorageError, type StorageResult } from "@/server/adapters/storage/types";
import { fail, withRetry, type RetryOptions } from "@/server/adapters/storage/retry";

export interface S3StorageOptions {
  bucket: string;
  client?: Pick<S3Client, "send">;
  clientConfig?: S3ClientConfig;
  /** Per-operation timeout. */
  timeoutMs?: number;
  retry?: Pick<RetryOptions, "attempts" | "baseDelayMs" | "maxDelayMs" | "sleep" | "random">;
}

/**
 * S3-compatible adapter. The SDK's own retries are disabled so retry policy lives in one place
 * (withRetry). Every call has an AbortSignal timeout; errors are normalized, and secrets and keys
 * never reach the message.
 */
export class S3Storage implements ObjectStorage {
  readonly driver = "s3" as const;
  private readonly client: Pick<S3Client, "send">;
  private readonly bucket: string;
  private readonly timeoutMs: number;
  private readonly retry: NonNullable<S3StorageOptions["retry"]>;

  constructor(opts: S3StorageOptions) {
    this.bucket = opts.bucket;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.retry = { attempts: 3, baseDelayMs: 200, maxDelayMs: 2_000, ...opts.retry };
    this.client = opts.client ?? new S3Client({ maxAttempts: 1, requestHandler: undefined, ...opts.clientConfig });
  }

  private async send<T>(command: unknown): Promise<StorageResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const out = (await this.client.send(command as never, { abortSignal: controller.signal } as never)) as T;
      return { ok: true, value: out };
    } catch (err) {
      return { ok: false, error: normalizeS3Error(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StorageResult<{ key: string; sha256: string }>> {
    assertSafeKey(key);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const result = await withRetry(
      () => this.send({ input: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: "AES256" } }) as never,
      this.retry,
    );
    if (!result.ok) return result;
    return { ok: true, value: { key, sha256 } };
  }

  async get(key: string): Promise<StorageResult<Buffer>> {
    assertSafeKey(key);
    const result = await withRetry(
      () => this.send<{ Body?: { transformToByteArray(): Promise<Uint8Array> } }>(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
      this.retry,
    );
    if (!result.ok) return result;
    const bytes = await result.value.Body?.transformToByteArray();
    if (!bytes) return fail("not_found", "empty object body", false);
    return { ok: true, value: Buffer.from(bytes) };
  }

  async delete(key: string): Promise<StorageResult<void>> {
    assertSafeKey(key);
    const result = await withRetry(() => this.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })), this.retry);
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  async ping(): Promise<StorageResult<{ latencyMs: number }>> {
    const started = Date.now();
    const result = await this.send(new HeadBucketCommand({ Bucket: this.bucket }));
    if (!result.ok) return result;
    return { ok: true, value: { latencyMs: Date.now() - started } };
  }
}

/** Map SDK / transport errors to the adapter's codes. Only timeouts, 5xx and resets are retryable. */
export function normalizeS3Error(err: unknown): StorageError {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number }; code?: string };
  const status = e.$metadata?.httpStatusCode;
  if (e.name === "AbortError" || e.name === "TimeoutError") {
    return { code: "timeout", message: "storage request timed out", retryable: true };
  }
  if (status === 403 || status === 401) return { code: "denied", message: "storage access denied", retryable: false };
  if (status === 404 || e.name === "NoSuchKey" || e.name === "NotFound") {
    return { code: "not_found", message: "object not found", retryable: false };
  }
  if (status !== undefined && status >= 500) return { code: "unavailable", message: `storage error ${status}`, retryable: true };
  if (e.code === "ECONNRESET" || e.code === "ECONNREFUSED" || e.code === "EAI_AGAIN") {
    return { code: "unavailable", message: "storage connection failed", retryable: true };
  }
  return { code: "unavailable", message: "storage request failed", retryable: false };
}
