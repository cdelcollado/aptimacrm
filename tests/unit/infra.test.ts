import { describe, expect, it, vi } from "vitest";
import { backoffDelay, withRetry } from "@/server/adapters/storage/retry";
import { backoffMs } from "@/server/jobs/queue";
import { redact } from "@/server/log/logger";
import { flashPath } from "@/server/web/flash";
import { MESSAGES, LOCALES } from "@/i18n/messages";
import { t } from "@/i18n/translate";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

describe("backoff", () => {
  it("grows exponentially and is capped", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
    expect(backoffMs(20)).toBe(10 * 60_000);
  });
  it("adds full jitter inside the ceiling", () => {
    expect(backoffDelay(2, { baseDelayMs: 100, maxDelayMs: 10_000, random: () => 0.5 })).toBe(200);
  });
});

describe("withRetry", () => {
  const sleep = vi.fn(async () => undefined);

  it("retries retryable errors then returns success", async () => {
    let calls = 0;
    const op = async () => {
      calls += 1;
      if (calls < 3) return { ok: false as const, error: { code: "unavailable" as const, message: "503", retryable: true } };
      return { ok: true as const, value: "done" };
    };
    const result = await withRetry(op, { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep });
    expect(result).toEqual({ ok: true, value: "done" });
    expect(calls).toBe(3);
  });

  it("does not retry non-retryable errors such as access denied", async () => {
    let calls = 0;
    const op = async () => {
      calls += 1;
      return { ok: false as const, error: { code: "denied" as const, message: "403", retryable: false } };
    };
    const result = await withRetry(op, { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep });
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("gives up after the configured attempts", async () => {
    let calls = 0;
    const op = async () => {
      calls += 1;
      return { ok: false as const, error: { code: "timeout" as const, message: "t", retryable: true } };
    };
    await withRetry(op, { attempts: 2, baseDelayMs: 1, maxDelayMs: 1, sleep });
    expect(calls).toBe(2);
  });
});

describe("log redaction", () => {
  it("replaces sensitive keys recursively and keeps other values", () => {
    const out = redact({ requestId: "r1", password: "p", nested: { apiToken: "t", signature: "s", count: 3 }, list: [{ body: "private" }] }) as Record<string, unknown>;
    expect(out.requestId).toBe("r1");
    expect(out.password).toBe("[redacted]");
    expect(out.nested).toEqual({ apiToken: "[redacted]", signature: "[redacted]", count: 3 });
    expect(out.list).toEqual([{ body: "[redacted]" }]);
  });
});

describe("flash notices", () => {
  it("encodes only catalogue keys and variables into the URL", () => {
    expect(flashPath("/pipeline", { ok: "pipeline.moved", vars: { stage: "Proposta" } })).toBe("/pipeline?ok=pipeline.moved&v_stage=Proposta");
  });
  it("appends to an existing query string", () => {
    expect(flashPath("/contacts?q=pau", { err: "errors.generic" })).toBe("/contacts?q=pau&err=errors.generic");
  });
});

describe("translations", () => {
  const keysOf = (locale: keyof typeof MESSAGES) => Object.keys(MESSAGES[locale]).sort();

  it("every locale defines exactly the same keys as English", () => {
    const en = keysOf("en");
    for (const locale of LOCALES) expect(keysOf(locale)).toEqual(en);
  });

  it("every literal t(locale, 'key') used in source exists in the catalogue", () => {
    const root = path.resolve(__dirname, "../../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|ts)$/.test(name)) files.push(full);
      }
    };
    walk(root);
    const known = new Set(keysOf("en"));
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bt\((?:locale|current|l|lang|\w+\.locale)\s*,\s*"([a-zA-Z0-9_.]+)"/g)) {
        if (!known.has(match[1]!)) missing.push(`${path.relative(root, file)}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("interpolates named variables and falls back to English", () => {
    expect(t("es", "pipeline.moved", { stage: "Proposta" })).toContain("Proposta");
    expect(t("ca", "dashboard.winRateHelp", { won: 2, closed: 5 })).toBe("2 guanyades de 5 tancades");
  });
});
