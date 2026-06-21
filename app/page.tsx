import { ArrowRight, LandmarkIcon } from "lucide-react";
import Link from "next/link";

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
    return (
      <main className="min-h-screen flex flex-col items-center justify-center">
        <div className="flex flex-row items-center text-4xl font-semibold space-x-2">
          <LandmarkIcon size={48} />
          <h1>Welcome to Colosseum.</h1>
        </div>
        {noSignups && (
          <p className="text-muted-foreground">Account creation is currently closed.</p>
        )}
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
