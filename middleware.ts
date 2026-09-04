import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { logInfo } from "@/lib/log";
import { NEXT_PARAM, safeNextPath } from "@/lib/next-path";

// Optimistic auth gate for routes that require a signed-in user: only checks
// that a session cookie exists (no DB lookup in middleware). The protected
// pages verify the session for real and redirect themselves, so a forged
// cookie gets no further than a login redirect one hop later.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The REST API and the screenshot route authenticate themselves (bearer
  // token / session checked in the handler) — just log the hit here so every
  // request that reaches the server shows up somewhere, without gating on a
  // session cookie these callers don't send.
  if (pathname.startsWith("/api/v1") || pathname === "/api/screenshot") {
    logInfo("http", `${request.method} ${pathname}`);
    return NextResponse.next();
  }

  const hasSession = Boolean(getSessionCookie(request));

  // `/` is the signed-out landing. A signed-in user has no business there —
  // send them straight to Explore at the edge so the hero never renders and
  // flashes before the page-level redirect fires. (Explore re-checks the
  // session for real and routes no-profile users on to onboarding.)
  if (pathname === "/") {
    if (hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/explore";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    // Carry where they were headed so login can finish the trip instead of
    // dropping them on their own profile. Filtered through safeNextPath here
    // too, so the param we write is one the login form will accept.
    const destination = `${pathname}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = "";
    if (safeNextPath(destination)) {
      url.searchParams.set(NEXT_PARAM, destination);
    }
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything else — public profiles (/[handle]), public channels, and the
  // /auth/* pages — stays open.
  matcher: ["/", "/invites/:path*", "/settings/:path*", "/api/v1/:path*", "/api/screenshot"],
};
