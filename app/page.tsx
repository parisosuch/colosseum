import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/colosseum/user";
import { signupsDisabled } from "@/lib/colosseum/config";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // if there is no user, immediately show the sign-in view

  if (!user) {
    const noSignups = signupsDisabled();
    // Invites are required once the first account exists; before that the
    // self-hoster can sign up freely. Default to invite-only if the check fails.
    const { data: inviteRequired } = await supabase.rpc("invite_required");
    return (
      <main className="min-h-screen flex flex-col items-center justify-center">
        <div className="flex flex-row items-center text-4xl font-semibold space-x-4">
          {/* ponytail: bottom-heavy mark reads high against text; nudge down to
              align optical centers. Tune the px if the type scale changes. */}
          <Logo className="h-10 w-auto" />
          <h1>Welcome to Colosseum.</h1>
        </div>
        <p className="text-muted-foreground">
          {noSignups
            ? "Account creation is currently closed."
            : (inviteRequired ?? true)
              ? "Account creation is invite only."
              : "Create the first account to get started."}
        </p>
        <div className="flex flex-row items-center mt-4 space-x-4">
          <Link href="/auth/login" className="flex flex-row items-center space-x-1">
            <p className="underline">Login</p>
            <ArrowRight size={16} />
          </Link>
          {!noSignups && (
            <Link href="/auth/sign-up" className="flex flex-row items-center space-x-1">
              <p className="underline">Create account</p>
              <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </main>
    );
  }

  // get the user handle and redirect to the user's profile

  const userProfile = await getUserProfile(supabase, user.id);

  // a freshly signed-up user has no profile yet — send them to onboarding
  if (!userProfile) {
    redirect("/auth/onboarding");
  }

  redirect(`/${userProfile.handle}`);
}
