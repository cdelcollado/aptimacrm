import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession } from "@/server/auth/session";
import type { Principal } from "@/server/authz/policy";
import { safeNextPath } from "@/server/security/guards";

/**
 * Every protected page and layout calls this. Signed-out and expired sessions redirect with a
 * reason so the sign-in screen can explain what happened, and return the user to the requested
 * path (set by src/proxy.ts). Record-level authorization is done by the queries, not here.
 */
export async function requirePrincipal(fallbackPath = "/dashboard"): Promise<Principal> {
  const state = await resolveSession();
  if (state.status === "ok") return state.principal;
  const requested = (await headers()).get("x-pathname") ?? fallbackPath;
  const next = encodeURIComponent(safeNextPath(requested));
  if (state.status === "expired") redirect(`/sign-in?reason=expired&next=${next}`);
  redirect(`/sign-in?next=${next}`);
}
