import { hmacSha256Hex, safeEqual } from "@/server/security/primitives";

/**
 * Provider-neutral signature check for the BCC/forward webhook.
 *   X-Aptima-Timestamp: unix seconds
 *   X-Aptima-Signature: sha256=<hex HMAC-SHA256 over `${timestamp}.${rawBody}`>
 * A timestamp outside the tolerance window is rejected so a captured request cannot be replayed
 * much later. Duplicate deliveries inside the window are handled by message-id idempotency.
 */

export const TOLERANCE_PAST_SECONDS = 5 * 60;
export const TOLERANCE_FUTURE_SECONDS = 60;

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "stale" | "future" | "bad_signature" | "not_configured" };

export function verifyInboundSignature(input: {
  secret: string | undefined;
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  nowSeconds: number;
}): SignatureResult {
  if (!input.secret) return { ok: false, reason: "not_configured" };
  if (!input.timestampHeader || !input.signatureHeader) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(input.timestampHeader)) return { ok: false, reason: "bad_timestamp" };

  const ts = Number(input.timestampHeader);
  const age = input.nowSeconds - ts;
  if (age > TOLERANCE_PAST_SECONDS) return { ok: false, reason: "stale" };
  if (-age > TOLERANCE_FUTURE_SECONDS) return { ok: false, reason: "future" };

  const expected = `sha256=${hmacSha256Hex(input.secret, `${input.timestampHeader}.${input.rawBody}`)}`;
  if (!safeEqual(expected, input.signatureHeader.trim())) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}
