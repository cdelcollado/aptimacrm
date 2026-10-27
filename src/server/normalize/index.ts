/**
 * Normalization used for duplicate suggestions and matching. Normalized values are what
 * the database compares; display values are kept separately so users see what they typed.
 */

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Providers whose domain says nothing about the employer, so they never suggest a company match. */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com",
  "yahoo.es", "icloud.com", "me.com", "proton.me", "protonmail.com", "gmx.com", "gmx.es",
  "hotmail.es", "terra.es", "telefonica.net", "orange.fr", "msn.com",
]);

/** Lowercase, trim, validate shape. Returns null when the address is not usable. */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (value.length === 0 || value.length > 254) return null;
  return EMAIL_RE.test(value) ? value : null;
}

/**
 * Domain from an email address or a website. `www.` is dropped; subdomains other than www
 * are kept, because `mail.acme.com` is not guaranteed to be the same organisation as `acme.com`.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (value.includes("@")) value = value.slice(value.lastIndexOf("@") + 1);
  value = value.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0] ?? "";
  value = value.replace(/\.$/, "").replace(/:\d+$/, "");
  if (value.startsWith("www.")) value = value.slice(4);
  if (value.length === 0 || value.length > 253) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) return null;
  return value;
}

/** Domain suitable for company duplicate suggestions (free mail providers excluded). */
export function companyDomainFromEmail(email: string | null): string | null {
  if (!email) return null;
  const domain = normalizeDomain(email);
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

/** Digits with a leading `+`. Spanish national numbers without prefix are assumed +34. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim();
  if (value === "") return null;
  value = value.replace(/[\s().-]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (/^[69]\d{8}$/.test(value)) value = `+34${value}`;
  if (!/^\+?\d{6,15}$/.test(value)) return null;
  return value.startsWith("+") ? value : `+${value}`;
}

const LEGAL_SUFFIX = /\b(s\.?l\.?u?|s\.?a\.?u?|ltd|inc|llc|gmbh|sarl|srl|slu|sau)\b/g;

/**
 * Name key for company duplicate suggestions: accent-insensitive, punctuation-free, without
 * legal suffixes ("Acme, S.L." and "ACME" give the same key).
 */
export function normalizeCompanyName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(LEGAL_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Lowercase and trim a name for comparison only (never for display). */
export function normalizeHeader(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
