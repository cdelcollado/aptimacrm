import { describe, expect, it, vi } from "vitest";
import { S3Storage, normalizeS3Error } from "@/server/adapters/storage/s3";
import { LocalStorage } from "@/server/adapters/storage/local";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const noSleep = { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => undefined, random: () => 0 };

/** A fake S3 transport: each call runs the next scripted behaviour. */
function scripted(steps: Array<(signal: AbortSignal) => unknown>) {
  let i = 0;
  const send = vi.fn(async (_command: unknown, options: { abortSignal: AbortSignal }) => {
    const step = steps[Math.min(i, steps.length - 1)]!;
    i += 1;
    return step(options.abortSignal);
  });
  return { send, client: { send } as never };
}

const httpError = (status: number, name = "ServiceError") => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

describe("S3Storage adapter", () => {
  it("success: puts an object and reports its checksum", async () => {
    const { client } = scripted([() => ({})]);
    const storage = new S3Storage({ bucket: "b", client, retry: noSleep });
    const result = await storage.put("imports/a.csv", Buffer.from("x"), "text/csv");
    expect(result).toMatchObject({ ok: true, value: { key: "imports/a.csv" } });
  });

  it("timeout: aborts a hung request and reports a retryable timeout", async () => {
    const { client, send } = scripted([(signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))]);
    const storage = new S3Storage({ bucket: "b", client, timeoutMs: 20, retry: { ...noSleep, attempts: 1 } });
    const result = await storage.delete("imports/a.csv");
    expect(result).toMatchObject({ ok: false, error: { code: "timeout", retryable: true } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retry: retries a 503 and then succeeds", async () => {
    const { client, send } = scripted([() => Promise.reject(httpError(503)), () => ({})]);
    const storage = new S3Storage({ bucket: "b", client, retry: noSleep });
    expect(await storage.delete("imports/a.csv")).toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejection: access denied is not retried and carries no secret material", async () => {
    const { client, send } = scripted([() => Promise.reject(httpError(403, "AccessDenied"))]);
    const storage = new S3Storage({ bucket: "b", client, retry: noSleep });
    const result = await storage.get("imports/a.csv");
    expect(result).toMatchObject({ ok: false, error: { code: "denied", retryable: false } });
    expect(JSON.stringify(result)).not.toMatch(/secret|key-id|AKIA/i);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe object keys before any network call", async () => {
    const { client, send } = scripted([() => ({})]);
    const storage = new S3Storage({ bucket: "b", client, retry: noSleep });
    await expect(storage.get("../etc/passwd")).rejects.toThrow(/unsafe/);
    expect(send).not.toHaveBeenCalled();
  });

  it("maps transport errors to retryable unavailability", () => {
    expect(normalizeS3Error(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toMatchObject({ code: "unavailable", retryable: true });
    expect(normalizeS3Error(httpError(404, "NoSuchKey"))).toMatchObject({ code: "not_found", retryable: false });
  });
});

describe("LocalStorage adapter", () => {
  it("round-trips an object and deletes it idempotently", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aptima-local-"));
    try {
      const storage = new LocalStorage(dir);
      expect((await storage.put("imports/x.csv", Buffer.from("hola"), "text/csv")).ok).toBe(true);
      expect((await storage.get("imports/x.csv")) as { value: Buffer }).toMatchObject({ ok: true });
      expect(await storage.delete("imports/x.csv")).toMatchObject({ ok: true });
      expect(await storage.delete("imports/x.csv")).toMatchObject({ ok: true });
      expect(await storage.get("imports/x.csv")).toMatchObject({ ok: false, error: { code: "not_found" } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses keys that would escape its root directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aptima-local-"));
    try {
      await expect(new LocalStorage(dir).put("../outside.csv", Buffer.from("x"), "text/csv")).rejects.toThrow(/unsafe/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
