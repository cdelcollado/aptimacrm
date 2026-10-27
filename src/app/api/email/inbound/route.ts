import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getConfig } from "@/server/config";
import { verifyInboundSignature } from "@/server/adapters/inbound-email/signature";
import { captureInboundEmail, parseInboundPayload } from "@/server/domain/email-capture";
import { rateLimit } from "@/server/security/rate-limit";
import { logger, newRequestId } from "@/server/log/logger";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Provider-neutral BCC/forward webhook. Verifies an HMAC over timestamp and raw body, rejects
 * replays outside a 5-minute window, and is idempotent per provider message id.
 * Response codes: 202 captured/ambiguous/unmatched, 200 duplicate, 400 invalid payload,
 * 401 bad signature, 413 too large, 429 rate limited, 503 not configured.
 */
export async function POST(request: Request) {
  const requestId = newRequestId();
  const headers = { "x-request-id": requestId };
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = rateLimit(`inbound:${ip}`, { max: 60, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "retry-after": String(limit.retryAfterSeconds) } });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413, headers });

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413, headers });

  const secret = getConfig().inboundEmailSecret;
  const sig = verifyInboundSignature({
    secret,
    timestampHeader: request.headers.get("x-aptima-timestamp"),
    signatureHeader: request.headers.get("x-aptima-signature"),
    rawBody: raw,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!sig.ok) {
    logger.warn("email.signature_rejected", { reason: sig.reason, requestId });
    if (sig.reason === "not_configured") return NextResponse.json({ error: "not_configured" }, { status: 503, headers });
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers });
  }
  const parsed = parseInboundPayload(json);
  if (!parsed.ok) return NextResponse.json({ error: "invalid_payload", fields: Object.keys(parsed.errors) }, { status: 400, headers });

  const rawSha256 = createHash("sha256").update(raw).digest("hex");
  try {
    const outcome = await captureInboundEmail(parsed.value, rawSha256, requestId);
    if (outcome.status === "duplicate") return NextResponse.json({ status: "duplicate" }, { status: 200, headers });
    return NextResponse.json({ status: outcome.status }, { status: 202, headers });
  } catch (err) {
    // Storage is retried by the provider: a 500 means "try again", and the message-id key keeps the retry idempotent.
    logger.error("email.capture_failed", { requestId, message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers: { ...headers, "retry-after": "30" } });
  }
}
