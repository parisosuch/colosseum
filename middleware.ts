import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic auth gate for routes that require a signed-in user: only checks
// that a session cookie exists (no DB lookup in middleware). The protected
// pages verify the session for real and redirect themselves, so a forged
// cookie gets no further than a login redirect one hop later.
export function middleware(request: NextRequest) {
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
  matcher: ["/invites/:path*", "/settings/:path*"],
};
