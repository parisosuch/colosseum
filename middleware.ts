import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { logInfo } from "@/lib/log";

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

  if (!getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything else — the landing page, public profiles (/[handle]), public
  // channels, and the /auth/* pages — stays open.
  matcher: ["/invites/:path*", "/settings/:path*", "/api/v1/:path*", "/api/screenshot"],
};
