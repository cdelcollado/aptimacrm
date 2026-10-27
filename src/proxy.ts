import { NextResponse, type NextRequest } from "next/server";

/**
 * Passes the requested path to server components through a request header so that a redirect to
 * sign-in can return the user to the page they asked for. Authorization is not decided here.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
