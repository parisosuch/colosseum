import Link from "next/link";

import { Logo } from "@/components/logo";
import { SignUpForm } from "@/components/sign-up-form";
import { signupsDisabled } from "@/lib/colosseum/config";
import { inviteRequired } from "@/lib/colosseum/invite";

export default async function Page() {
  // The first account ever (the self-hoster) signs up without a code; after
  // that, invites are required.
  const inviteOnly = await inviteRequired();

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
          <SignUpForm inviteRequired={inviteOnly} />
        )}
      </div>
    </div>
  );
}
