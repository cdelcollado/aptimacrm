/**
 * Small, pure guards for untrusted input. Kept dependency-free so they are trivially
 * unit-testable and reused by actions, route handlers and the CSV importer.
 */

/**
 * Only same-origin relative paths are allowed as post-login redirects. Rejects absolute
 * URLs, protocol-relative `//host` and backslash tricks such as `/\evil.com`.
 */
export function safeNextPath(input: string | null | undefined, fallback = "/dashboard"): string {
  if (!input || typeof input !== "string") return fallback;
  if (input.length > 512) return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//") || input.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(input)) return fallback;
  return input;
}

/** Trim, collapse internal whitespace and enforce a maximum length. Empty -> null. */
export function cleanText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") return null;
  const collapsed = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, maxLength);
}

/** Free text that may contain line breaks (activity bodies). Keeps \n, strips other controls. */
export function cleanMultiline(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, maxLength);
}

/**
 * Parse a money input typed by a human ("1.250,50", "1250.5", "1250") into integer cents.
 * Returns null for anything that is not a non-negative amount with at most two decimals.
 */
export function parseEuroToCents(input: string): number | null {
  const raw = input.trim().replace(/\s/g, "").replace(/€/g, "");
  if (raw === "") return 0;
  let normalized = raw;
  if (raw.includes(",") && raw.includes(".")) {
    normalized = raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    normalized = raw.replace(",", ".");
  }
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, frac = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null;
}

/** Strict ISO calendar date (YYYY-MM-DD) that round-trips, so 2026-02-31 is rejected. */
export function parseIsoDate(input: string | null | undefined): string | null {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const d = new Date(`${input}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === input ? input : null;
}

/** UUID shape check before hitting the DB, so malformed ids become not-found, not 500s. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
