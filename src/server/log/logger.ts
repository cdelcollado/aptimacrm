import { randomUUID } from "node:crypto";

/**
 * Structured JSON logger. Keys matching SENSITIVE_KEY are redacted recursively so a
 * careless `log({ body })` cannot leak credentials, tokens, signatures or message bodies.
 */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /pass(word)?|token|secret|signature|cookie|authorization|body|raw|key(?!s?_?id)/i;
const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): Level {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  return configured && configured in LEVEL_ORDER ? configured : "info";
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value as Fields)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export function log(level: Level, event: string, fields: Fields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...(redact(fields) as Fields),
  });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (event: string, fields?: Fields) => log("debug", event, fields),
  info: (event: string, fields?: Fields) => log("info", event, fields),
  warn: (event: string, fields?: Fields) => log("warn", event, fields),
  error: (event: string, fields?: Fields) => log("error", event, fields),
};

export function newRequestId(): string {
  return randomUUID();
}

/** Mask an email for logs: keep the domain and a short hash prefix, never the local part. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "[invalid]";
  const domain = email.slice(at + 1);
  return `***@${domain}`;
}
