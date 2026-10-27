import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import type { Principal, Role } from "@/server/authz/policy";
import { newOpaqueToken, sha256Hex, verifyPassword } from "@/server/security/primitives";
import { getConfig } from "@/server/config";
import { logger, maskEmail } from "@/server/log/logger";
import { normalizeEmail } from "@/server/normalize";
import { recordAudit } from "@/server/domain/audit";
import { peekRateLimit, rateLimit, resetRateLimit } from "@/server/security/rate-limit";

export const SESSION_COOKIE = "aptima_session";
/** Idle timeout: a session unused for this long is expired. */
export const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
/** Absolute lifetime regardless of activity. */
export const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function sessionCookieName(): string {
  return getConfig().cookieSecure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

export type SessionState =
  | { status: "ok"; principal: Principal; sessionId: string }
  | { status: "missing" }
  | { status: "expired" };

/** Verify a password and return the active user, or null. Rate-limited per email. */
export async function authenticate(emailInput: string, password: string): Promise<{ userId: string } | null> {
  const email = normalizeEmail(emailInput);
  if (!email) return null;
  // Only failures count against the budget; a successful sign-in clears it.
  const key = `signin:${email}`;
  const limit = { max: 5, windowMs: 15 * 60 * 1000 };
  const gate = peekRateLimit(key, limit);
  if (!gate.allowed) {
    logger.warn("auth.rate_limited", { email: maskEmail(email) });
    throw new AuthRateLimitError(gate.retryAfterSeconds);
  }
  const [user] = await getDb().select().from(users).where(eq(users.emailNormalized, email)).limit(1);
  // Always run a verification so timing does not reveal whether the email exists.
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const valid = await verifyPassword(password, hash);
  if (!user || !user.active || !valid) {
    rateLimit(key, limit);
    return null;
  }
  resetRateLimit(key);
  return { userId: user.id };
}

export class AuthRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("rate limited");
  }
}

// Precomputed scrypt hash of a random value, used only to equalise timing for unknown users.
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function createSession(userId: string, requestId?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newOpaqueToken();
  const expiresAt = new Date(Date.now() + ABSOLUTE_TIMEOUT_MS);
  await getDb().insert(sessions).values({
    userId,
    tokenHash: sha256Hex(token),
    expiresAt,
  });
  await recordAudit(getDb(), { actorId: userId, action: "user.signed_in", subjectType: "user", subjectId: userId, requestId });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getConfig().cookieSecure,
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(sessionCookieName());
}

/**
 * Resolve the current request's session. Expired and revoked sessions are distinguished
 * from missing ones so the UI can say "your session expired" instead of a generic message.
 */
export async function resolveSession(): Promise<SessionState> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value ?? store.get(SESSION_COOKIE)?.value;
  if (!token) return { status: "missing" };
  return resolveSessionToken(token);
}

export async function resolveSessionToken(token: string): Promise<SessionState> {
  const db = getDb();
  const tokenHash = sha256Hex(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      userId: users.id,
      name: users.name,
      role: users.role,
      locale: users.locale,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.revokedAt || !row.active) return { status: "missing" };

  const now = Date.now();
  const idleExpired = now - row.lastSeenAt.getTime() > IDLE_TIMEOUT_MS;
  const absoluteExpired = row.expiresAt.getTime() <= now;
  if (idleExpired || absoluteExpired) return { status: "expired" };

  if (now - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(now) }).where(eq(sessions.id, row.sessionId));
  }

  return {
    status: "ok",
    sessionId: row.sessionId,
    principal: {
      userId: row.userId,
      name: row.name,
      role: row.role as Role,
      locale: row.locale as Principal["locale"],
    },
  };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), isNull(sessions.revokedAt)));
}

/** Count active sessions for a user; used by the health/diagnostic view. */
export async function countActiveSessions(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  return row?.n ?? 0;
}
