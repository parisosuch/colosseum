import { LoginForm } from "@/components/login-form";
import { signupsDisabled } from "@/lib/colosseum/config";
import { inviteRequired } from "@/lib/colosseum/invite";
import { safeNextPath } from "@/lib/next-path";
import { signupState } from "@/lib/signup-state";

// Per-request, never prerendered: the note under the form depends on whether
// any account exists yet, which flips at runtime, and the build machine has no
// database.
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; next?: string; reset?: string }>;
}) {
  // Carry a shared invite link's ?invite=CODE through to sign-up. ?next= is
  // where the auth gate bounced them from, filtered through the allowlist here
  // so the form is only ever handed a destination we already trust. ?reset=1
  // means they just set a new password and have to use it once.
  const { invite, next, reset } = await searchParams;
  const state = signupState({
    signupsDisabled: signupsDisabled(),
    inviteRequired: await inviteRequired(),
  });
  return (
    <div className="w-full lg:max-w-sm">
      <LoginForm
        invite={invite ?? ""}
        next={safeNextPath(next) ?? ""}
        passwordUpdated={reset === "1"}
        signupState={state}
      />
    </div>
  );
}
