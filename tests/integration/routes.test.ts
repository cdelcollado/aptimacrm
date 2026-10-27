import { describe, expect, it, vi, beforeEach } from "vitest";
import { hmacSha256Hex } from "@/server/security/primitives";
import { getDb } from "@/server/db/client";
import { activities, inboundEmails } from "@/server/db/schema";
import { makeCompany, makeContact, makeDeal, makeStages, makeUser } from "../helpers/db";
import { createSession } from "@/server/auth/session";
import { sha256Hex } from "@/server/security/primitives";
import { eq } from "drizzle-orm";
import { POST as inboundPost } from "@/app/api/email/inbound/route";
import { GET as healthGet } from "@/app/api/health/route";

/** Route handlers read the session cookie through next/headers, which needs a request scope. Stub it. */
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const SECRET = "test-inbound-secret-0123456789abcdef";

function signedRequest(body: unknown, opts: { ts?: number; secret?: string; signature?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = opts.signature ?? `sha256=${hmacSha256Hex(opts.secret ?? SECRET, `${ts}.${raw}`)}`;
  return new Request("http://localhost/api/email/inbound", {
    method: "POST",
    headers: { "content-type": "application/json", "x-aptima-timestamp": ts, "x-aptima-signature": sig, host: "localhost" },
    body: raw,
  });
}

const email = (messageId: string, from = "pau@acme.es") => ({
  messageId,
  receivedAt: new Date().toISOString(),
  from,
  to: "capture@crm.example.com",
  subject: "Proposta",
  text: "Ok, endavant.",
});

async function setupContact() {
  const ana = await makeUser("salesperson", "Ana Ruiz");
  const company = await makeCompany(ana.id, "Acme", "acme.es");
  const stages = await makeStages();
  const pau = await makeContact(ana.id, "Pau", "pau@acme.es", company.id);
  await makeDeal({ ownerId: ana.id, companyId: company.id, stageId: stages.Proposta!, primaryContactId: pau.id });
  return { ana, pau };
}

describe("POST /api/email/inbound", () => {
  beforeEach(() => cookieJar.clear());

  it("rejects a bad signature with 401 and creates nothing", async () => {
    await setupContact();
    const res = await inboundPost(signedRequest(email("m-1"), { signature: "sha256=00" }));
    expect(res.status).toBe(401);
    expect(await getDb().select().from(inboundEmails)).toHaveLength(0);
  });

  it("rejects a replayed request outside the time window", async () => {
    await setupContact();
    const res = await inboundPost(signedRequest(email("m-2"), { ts: Math.floor(Date.now() / 1000) - 3600 }));
    expect(res.status).toBe(401);
  });

  it("captures a valid email with 202 and a duplicate delivery with 200 and no second activity", async () => {
    await setupContact();
    const first = await inboundPost(signedRequest(email("m-3")));
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "captured" });

    const second = await inboundPost(signedRequest(email("m-3")));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "duplicate" });

    expect(await getDb().select().from(activities).where(eq(activities.kind, "email"))).toHaveLength(1);
  });

  it("returns 400 for a payload that is not an email capture", async () => {
    await setupContact();
    const res = await inboundPost(signedRequest({ messageId: "", from: "nope" }));
    expect(res.status).toBe(400);
  });

  it("refuses requests when no secret is configured (503, never accepts unsigned traffic)", async () => {
    const original = process.env.INBOUND_EMAIL_SECRET;
    const { resetConfigCache } = await import("@/server/config");
    delete process.env.INBOUND_EMAIL_SECRET;
    resetConfigCache();
    try {
      const res = await inboundPost(signedRequest(email("m-x")));
      expect(res.status).toBe(503);
    } finally {
      process.env.INBOUND_EMAIL_SECRET = original;
      resetConfigCache();
    }
  });
});

describe("GET /api/health", () => {
  it("reports database and storage status without secrets", async () => {
    const res = await healthGet();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.storage.ok).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\/|password|secret/i);
  });
});

describe("sessions", () => {
  it("an expired session is reported as expired, not as a generic missing session", async () => {
    const { resolveSessionToken } = await import("@/server/auth/session");
    const ana = await makeUser("salesperson", "Ana Ruiz");
    const { token } = await createSession(ana.id);
    const db = getDb();
    const { sessions } = await import("@/server/db/schema");
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, sha256Hex(token)));
    expect(await resolveSessionToken(token)).toEqual({ status: "expired" });
  });

  it("a revoked session is treated as missing", async () => {
    const { resolveSessionToken, revokeSessionByToken } = await import("@/server/auth/session");
    const ana = await makeUser("salesperson", "Ana Ruiz");
    const { token } = await createSession(ana.id);
    await revokeSessionByToken(token);
    expect(await resolveSessionToken(token)).toEqual({ status: "missing" });
  });

  it("an idle session (no activity for 8 hours) is expired", async () => {
    const { resolveSessionToken } = await import("@/server/auth/session");
    const ana = await makeUser("salesperson", "Ana Ruiz");
    const { token } = await createSession(ana.id);
    const { sessions } = await import("@/server/db/schema");
    await getDb().update(sessions).set({ lastSeenAt: new Date(Date.now() - 9 * 3600_000) }).where(eq(sessions.tokenHash, sha256Hex(token)));
    expect(await resolveSessionToken(token)).toEqual({ status: "expired" });
  });

  it("sign-in is rate limited per email after repeated failures", async () => {
    const { authenticate, AuthRateLimitError } = await import("@/server/auth/session");
    const { resetRateLimits } = await import("@/server/security/rate-limit");
    resetRateLimits();
    await makeUser("salesperson", "Ana Ruiz", "ana@test.example");
    for (let i = 0; i < 5; i++) expect(await authenticate("ana@test.example", "wrong")).toBeNull();
    await expect(authenticate("ana@test.example", "wrong")).rejects.toBeInstanceOf(AuthRateLimitError);
  });
});
