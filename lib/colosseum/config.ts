// App-level configuration toggles read from the environment.

// Whether new account sign-ups are blocked. Controlled by the server-side
// DISABLE_SIGNUPS env var so self-hosters can close registration at runtime
// without a rebuild (it is not NEXT_PUBLIC, so it never reaches the browser).
//
// Enforced in the sign-up UI and, authoritatively, in the Better Auth
// user-create hook (lib/auth.ts) — sign-up runs through our server.
export function signupsDisabled(): boolean {
  return process.env.DISABLE_SIGNUPS === "true";
}
