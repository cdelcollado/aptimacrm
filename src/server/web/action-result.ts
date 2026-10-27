import { DomainError, ValidationError } from "@/server/errors";
import { logger } from "@/server/log/logger";
import { t, type Locale, type MessageKey } from "@/i18n";

/**
 * The shape every server action returns to the UI. Actions that are called from forms redirect
 * (PRG pattern); actions called from client components return this so the UI can announce it.
 */
export type ActionResult =
  | { ok: true; message: string; redirectTo?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string>; code?: string };

/** Map a thrown error to user-facing text. Unknown errors are logged with a request id and generic copy. */
export function toActionResult(err: unknown, locale: Locale, requestId: string, context: Record<string, unknown> = {}): ActionResult {
  if (err instanceof ValidationError) {
    // Messages are translated from the codes. The English text in the domain error is for logs only.
    const translated = Object.fromEntries(
      Object.entries(err.fieldErrors).map(([field, code]) => [field, t(locale, errorKey(code))]),
    );
    const first = Object.values(err.fieldErrors)[0];
    const message = first ? t(locale, errorKey(first)) : t(locale, "errors.generic");
    return { ok: false, message, fieldErrors: translated, code: "validation" };
  }
  if (err instanceof DomainError) {
    const key: MessageKey =
      err.code === "not_found" ? "notFound.title"
      : err.code === "forbidden" ? "errors.forbidden"
      : err.code === "conflict" ? "errors.conflict"
      : "errors.generic";
    return { ok: false, message: t(locale, key), code: err.code };
  }
  logger.error("action.unhandled", {
    requestId,
    ...context,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.split("\n").slice(0, 4).join(" | ") : undefined,
  });
  return { ok: false, message: t(locale, "errors.generic"), code: "internal" };
}

function errorKey(code: string): MessageKey {
  const map: Record<string, MessageKey> = {
    required: "errors.required",
    invalid: "errors.invalid",
    duplicate: "errors.duplicate",
    unknown_user: "errors.unknown_user",
    open_deals: "errors.open_deals",
    reason_required: "errors.reason_required",
    different_company: "errors.different_company",
    no_open_stage: "errors.no_open_stage",
    not_active: "errors.not_active",
    invalid_pair: "errors.invalid_pair",
    not_correctable: "errors.not_correctable",
    future: "errors.future",
    not_for_contact: "errors.not_for_contact",
    no_match: "errors.no_match",
    missing: "errors.missing",
    too_many_rows: "errors.too_many_rows",
    too_large: "errors.too_large",
    bad_encoding: "errors.bad_encoding",
    empty: "errors.empty",
    malformed: "errors.malformed",
    no_header: "errors.no_header",
    storage: "errors.storage",
    not_found: "errors.not_found",
    unknown_stage: "errors.invalid",
    dealId: "errors.invalid",
  };
  return map[code] ?? "errors.invalid";
}

/** Read a string from FormData without trusting its type. */
export function field(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

export function fieldOrNull(fd: FormData, name: string): string | null {
  const v = field(fd, name).trim();
  return v === "" ? null : v;
}

export function intField(fd: FormData, name: string): number | null {
  const v = field(fd, name).trim();
  if (!/^\d{1,9}$/.test(v)) return null;
  return Number(v);
}

export function ownerOf(fd: FormData): string | null {
  return fieldOrNull(fd, "ownerId");
}
