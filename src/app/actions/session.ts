"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authenticate, AuthRateLimitError, createSession, clearSessionCookie, revokeSessionByToken, setSessionCookie, SESSION_COOKIE, sessionCookieName } from "@/server/auth/session";
import { field } from "@/server/web/action-result";
import { flashPath } from "@/server/web/flash";
import { newRequestId } from "@/server/log/logger";
import { safeNextPath } from "@/server/security/guards";
import { isLocale, LOCALE_COOKIE } from "@/i18n";

/** Sign-in is a plain form: it works without JavaScript. Failures redirect with a message key. */
export async function signInAction(formData: FormData): Promise<void> {
  const requestId = newRequestId();
  const next = safeNextPath(field(formData, "next"));
  let userId: string | null = null;
  try {
    const user = await authenticate(field(formData, "email"), field(formData, "password"));
    userId = user?.userId ?? null;
  } catch (err) {
    if (err instanceof AuthRateLimitError) {
      redirect(flashPath(`/sign-in?next=${encodeURIComponent(next)}`, { err: "signin.rateLimited", vars: { seconds: err.retryAfterSeconds } }));
    }
    throw err;
  }
  if (!userId) {
    redirect(flashPath(`/sign-in?next=${encodeURIComponent(next)}`, { err: "signin.invalid" }));
  }
  const { token, expiresAt } = await createSession(userId, requestId);
  await setSessionCookie(token, expiresAt);
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value ?? store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionByToken(token);
  await clearSessionCookie();
  redirect(flashPath("/sign-in", { ok: "signin.signedOut" }));
}

export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = field(formData, "locale");
  const next = safeNextPath(field(formData, "next"));
  if (isLocale(locale)) {
    const store = await cookies();
    store.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365, httpOnly: false });
  }
  redirect(next);
}
