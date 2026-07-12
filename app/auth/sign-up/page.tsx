import Link from "next/link";

import { Logo } from "@/components/logo";
import { SignUpForm } from "@/components/sign-up-form";
import { signupsDisabled } from "@/lib/colosseum/config";
import { inviteRequired } from "@/lib/colosseum/invite";

// Per-request, never prerendered: whether an invite is needed flips at runtime
// (the moment the first account exists), and the build machine has no database.
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  // The first account ever (the self-hoster) signs up without a code; after
  // that, invites are required.
  const inviteOnly = await inviteRequired();
  // Prefilled from a shared invite link (?invite=CODE), so the invitee never
  // has to transcribe the code.
  const { invite } = await searchParams;

  return (
    <div className="flex flex-1 justify-center md:justify-start">
      <div className="w-full max-w-sm">
        {signupsDisabled() ? (
          <div className="flex flex-col gap-2">
            <Logo className="h-4 w-auto text-muted-foreground opacity-25" />
            <h1 className="text-title">Sign-ups are closed</h1>
            <p className="text-muted-foreground">
              New account registration is currently disabled. If you already have an account, you
              can{" "}
              <Link href="/auth/login" className="underline underline-offset-4">
                log in
              </Link>
              .
            </p>
          </div>
        ) : (
          <SignUpForm inviteRequired={inviteOnly} invite={invite ?? ""} />
        )}
      </div>
    </div>
  );
}
