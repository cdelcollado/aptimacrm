import { describe, expect, it } from "vitest";
import { verifyInboundSignature, TOLERANCE_PAST_SECONDS } from "@/server/adapters/inbound-email/signature";
import { hmacSha256Hex } from "@/server/security/primitives";

const SECRET = "test-secret-value";
const body = JSON.stringify({ messageId: "m-1" });
const now = 1_800_000_000;

function sign(ts: number, payload = body, secret = SECRET) {
  return `sha256=${hmacSha256Hex(secret, `${ts}.${payload}`)}`;
}

describe("verifyInboundSignature", () => {
  it("accepts a correct, fresh signature", () => {
    expect(verifyInboundSignature({ secret: SECRET, timestampHeader: String(now), signatureHeader: sign(now), rawBody: body, nowSeconds: now })).toEqual({ ok: true });
  });

  it("rejects a body that was changed after signing", () => {
    const result = verifyInboundSignature({ secret: SECRET, timestampHeader: String(now), signatureHeader: sign(now), rawBody: body + " ", nowSeconds: now });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature made with another secret", () => {
    const result = verifyInboundSignature({ secret: SECRET, timestampHeader: String(now), signatureHeader: sign(now, body, "other"), rawBody: body, nowSeconds: now });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a replayed request outside the tolerance window", () => {
    const old = now - TOLERANCE_PAST_SECONDS - 1;
    const result = verifyInboundSignature({ secret: SECRET, timestampHeader: String(old), signatureHeader: sign(old), rawBody: body, nowSeconds: now });
    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects timestamps too far in the future", () => {
    const future = now + 600;
    const result = verifyInboundSignature({ secret: SECRET, timestampHeader: String(future), signatureHeader: sign(future), rawBody: body, nowSeconds: now });
    expect(result).toEqual({ ok: false, reason: "future" });
  });

  it("rejects missing headers and malformed timestamps", () => {
    expect(verifyInboundSignature({ secret: SECRET, timestampHeader: null, signatureHeader: null, rawBody: body, nowSeconds: now })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifyInboundSignature({ secret: SECRET, timestampHeader: "12abc", signatureHeader: "sha256=x", rawBody: body, nowSeconds: now })).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("refuses to verify when no secret is configured", () => {
    expect(verifyInboundSignature({ secret: undefined, timestampHeader: String(now), signatureHeader: sign(now), rawBody: body, nowSeconds: now })).toEqual({ ok: false, reason: "not_configured" });
  });
});
