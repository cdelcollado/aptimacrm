/**
 * Domain errors. Each carries a stable `code` so UI copy can be localized and logs stay
 * greppable. Messages here are developer-facing; users see translated text keyed by code.
 */

export type DomainErrorCode =
  | "validation"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "invariant"
  | "unauthenticated"
  | "rate_limited"
  | "dependency";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>, message = "Validation failed") {
    super("validation", message, { fieldErrors });
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export const notFound = (what: string) => new DomainError("not_found", `${what} not found`);
export const forbidden = (message = "Not allowed") => new DomainError("forbidden", message);
export const conflict = (message: string) => new DomainError("conflict", message);

/** Postgres error codes we map to domain errors when a constraint is hit. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export function isCheckViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23514";
}

export function isAppendOnlyViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42501";
}

/** Result type for adapter boundaries: never throw raw SDK errors into domain code. */
export type Result<T, E = DomainError> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = <E>(error: E): Result<never, E> => ({ ok: false, error });
