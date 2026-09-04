// The `?next=` destination the auth gate carries through login, and the
// allowlist that keeps it from becoming an open redirect. Shared by the
// middleware (which writes the param) and the login form (which reads it), so
// both agree on what counts as a legal destination.

export const NEXT_PARAM = "next";

// Only the routes the middleware actually gates can be a login destination.
// Everything else the app serves is public, so a signed-out user reaching it
// never hits the login redirect in the first place; anything outside this list
// arriving as `?next=` was put there by someone else.
const ALLOWED_PREFIXES = ["/invites", "/settings"];

// Returns the path when it is a destination we are willing to send a
// just-logged-in user to, otherwise null (the caller falls back to its own
// default). Rejects anything that could leave the origin: a scheme-relative
// `//evil.com`, a backslash some browsers normalize to a slash, and any
// absolute URL — only a same-origin path starting with a single `/` survives.
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }
  const path = value.split(/[?#]/)[0];
  const allowed = ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  return allowed ? value : null;
}
