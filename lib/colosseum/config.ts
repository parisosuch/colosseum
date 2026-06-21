// App-level configuration toggles read from the environment.

// Whether new account sign-ups are blocked. Controlled by the server-side
// DISABLE_SIGNUPS env var so self-hosters can close registration at runtime
// without a rebuild (it is not NEXT_PUBLIC, so it never reaches the browser).
//
// NOTE: this gates the app's sign-up UI only. Because sign-up is a direct
// browser -> Supabase Auth call, the authoritative block is Supabase's own
// `enable_signup = false` (supabase/config.toml, self-hosted
// GOTRUE_DISABLE_SIGNUP=true, or the hosted dashboard toggle). Set both for a
// hard block.
export function signupsDisabled(): boolean {
  return process.env.DISABLE_SIGNUPS === "true";
}
