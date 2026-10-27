import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type ObjectStorage, type StorageResult } from "@/server/adapters/storage/types";
import { fail } from "@/server/adapters/storage/retry";

/**
 * Development and test storage: a private directory, never served by the web server.
 * Honours the same contract as S3 so the domain code path is identical.
 */
export class LocalStorage implements ObjectStorage {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.join(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("storage path escaped root");
    return full;
  }

  // contentType is accepted for interface parity with S3 and not used on disk.
  async put(key: string, body: Buffer, _contentType?: string): Promise<StorageResult<{ key: string; sha256: string }>> {
    // Unsafe keys are programming errors: throw, do not report as a storage outage.
    const full = this.resolve(key);
    try {
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body, { mode: 0o600 });
      return { ok: true, value: { key, sha256: createHash("sha256").update(body).digest("hex") } };
    } catch (err) {
      return fail("unavailable", `local put failed: ${(err as NodeJS.ErrnoException).code ?? "unknown"}`, false);
    }
  }

  async get(key: string): Promise<StorageResult<Buffer>> {
    try {
      return { ok: true, value: await readFile(this.resolve(key)) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return fail("not_found", "object not found", false);
      return fail("unavailable", "local read failed", true);
    }
  }

  async delete(key: string): Promise<StorageResult<void>> {
    try {
      await rm(this.resolve(key), { force: true });
      return { ok: true, value: undefined };
    } catch {
      return fail("unavailable", "local delete failed", true);
    }
  }

  async ping(): Promise<StorageResult<{ latencyMs: number }>> {
    const started = Date.now();
    try {
      await mkdir(this.root, { recursive: true });
      await stat(this.root);
      return { ok: true, value: { latencyMs: Date.now() - started } };
    } catch {
      return fail("unavailable", "storage root not accessible", true);
    }
  }
}
