import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { inviteRequired } from "@/lib/colosseum/invite";
import { getUserProfile } from "@/lib/colosseum/user";
import { getActivityFeed } from "@/lib/colosseum/activity";
import { signupsDisabled } from "@/lib/colosseum/config";
import ExploreView from "@/components/explore-view";

export default async function Home() {
  const user = await getSessionUser();

  // if there is no user, immediately show the sign-in view

  if (!user) {
    const noSignups = signupsDisabled();
    // Invites are required once the first account exists; before that the
    // self-hoster can sign up freely.
    const inviteOnly = await inviteRequired();
    return (
      <div className="flex flex-1 flex-col items-center md:items-start gap-8 text-center md:text-left">
        <div className="flex flex-col items-center md:items-start gap-3">
          <h1 className="font-serif text-5xl lg:text-6xl font-semibold">
            Welcome to Colosseum
            <Logo className="inline-block h-3 w-auto align-baseline ml-1" />
          </h1>
          <p className="text-lg text-muted-foreground">
            {noSignups
              ? "Account creation is currently closed."
              : inviteOnly
                ? "Account creation is invite only."
                : "Create the first account to get started."}
          </p>
        </div>
        <div className="flex flex-row items-center gap-5">
          <Button asChild>
            <Link href="/auth/login">
              Login
              <ArrowRight />
            </Link>
          </Button>
          {!noSignups && (
            <Link
              href="/auth/sign-up"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Create account
            </Link>
          )}
        </div>
      </div>
    );
  }

  const userProfile = await getUserProfile(user.id);

  // a freshly signed-up user has no profile yet — send them to onboarding
  if (!userProfile) {
    redirect("/auth/onboarding");
  }

  // Home is the explore page: a feed of recent public activity from across the
  // (invite-connected) network.
  const activity = await getActivityFeed();
  return <ExploreView activity={activity} />;
}
