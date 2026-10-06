import { LayoutGrid, Plus, Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { inviteRequired } from "@/lib/colosseum/invite";
import { getUserProfile } from "@/lib/colosseum/user";
import { signupsDisabled } from "@/lib/colosseum/config";
import { signUpHref, signupState } from "@/lib/signup-state";

const POINTS = [
  { icon: Plus, label: "Collect", line: "Paste a link, drop in an image, or type a note." },
  { icon: LayoutGrid, label: "Arrange", line: "Put things in order, or lay them out on a canvas." },
  { icon: Users, label: "Share", line: "Keep a channel to yourself, or open it to others." },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const user = await getSessionUser();

  // if there is no user, immediately show the sign-in view

  if (!user) {
    // Invites are required once the first account exists; before that the
    // self-hoster can sign up freely.
    const state = signupState({
      signupsDisabled: signupsDisabled(),
      inviteRequired: await inviteRequired(),
    });
    // Carry a shared invite link's ?invite=CODE through to login/sign-up so a
    // confused invitee who lands on the home page doesn't lose their code.
    const { invite = "" } = await searchParams;
    const loginHref = invite ? `/auth/login?invite=${encodeURIComponent(invite)}` : "/auth/login";
    return (
      <div className="flex flex-col gap-8 lg:gap-10 [@media(min-width:1024px)_and_(max-height:760px)]:gap-8">
        <div className="flex flex-col gap-4 lg:gap-5">
          <h1 className="text-hero">
            <span className="block">A place for the</span>
            <span className="block">things you find.</span>
          </h1>
          <p className="text-base text-muted-foreground lg:text-lg">
            Save images, links, notes, files and videos into boards called channels. Keep a channel
            to yourself, or share it with the people you choose.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <Button asChild size="lg" className="h-11 w-full lg:h-10 lg:w-fit">
            <Link href={state === "first" ? signUpHref(invite) : loginHref}>
              {state === "first" ? "Create the first account" : "Log in"}
            </Link>
          </Button>
          <p className="text-center text-sm text-muted-foreground lg:text-left">
            {state === "invite" ? (
              <>
                Have an invite?{" "}
                <Link
                  href={signUpHref(invite)}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Use an invite
                </Link>
              </>
            ) : state === "first" ? (
              "No one has an account here yet. After the first, new accounts need an invite."
            ) : (
              "New accounts are closed on this server."
            )}
          </p>
        </div>
        <ul className="flex flex-col gap-5 border-t pt-6 lg:gap-4">
          {POINTS.map(({ icon: Icon, label, line }) => (
            <li key={label} className="flex items-start gap-3 lg:items-center">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card">
                <Icon className="size-4" aria-hidden />
              </span>
              <p className="flex flex-col gap-0.5 text-sm lg:flex-row lg:gap-2">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground">{line}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const userProfile = await getUserProfile(user.id);

  // a freshly signed-up user has no profile yet — send them to onboarding
  if (!userProfile) {
    redirect("/auth/onboarding");
  }

  // `/` is the full-bleed hero landing (signed-out); a signed-in user goes to
  // Explore, which lives on its own route so it renders inside the app chrome.
  redirect("/explore");
}
