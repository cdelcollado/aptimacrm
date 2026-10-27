import type { Principal } from "@/server/authz/policy";

/** Build the Principal the app would derive from a session for this user row. */
export function asPrincipal(user: { id: string; name: string; role: string }): Principal {
  return { userId: user.id, name: user.name, role: user.role as Principal["role"], locale: "es" };
}
