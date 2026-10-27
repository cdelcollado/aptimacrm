/**
 * Route handlers that accept cookie-authenticated POSTs (uploads) check that the request came from
 * this site. SameSite=Lax already blocks most cross-site POSTs; this is the second check.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
