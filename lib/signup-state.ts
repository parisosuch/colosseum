// Which of the three account-creation states this instance is in, for the
// signed-out pages (landing and login) that word their actions around it.
//
// - "closed": DISABLE_SIGNUPS is on, so nobody can create an account.
// - "first": no account exists yet; the self-hoster signs up without a code.
// - "invite": the default once the first account exists.
//
// Closed wins over first: a fresh instance started with sign-ups disabled has
// no way to create an account, and saying otherwise sends people to a dead end.
export type SignupState = "closed" | "first" | "invite";

export function signupState({
  signupsDisabled,
  inviteRequired,
}: {
  signupsDisabled: boolean;
  inviteRequired: boolean;
}): SignupState {
  if (signupsDisabled) return "closed";
  return inviteRequired ? "invite" : "first";
}

// The sign-up link for a carried ?invite=CODE, or the bare page without one.
export function signUpHref(invite: string): string {
  return invite ? `/auth/sign-up?invite=${encodeURIComponent(invite)}` : "/auth/sign-up";
}
