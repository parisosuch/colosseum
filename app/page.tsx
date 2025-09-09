import { ArrowRight, LandmarkIcon } from "lucide-react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserProfile } from "@/lib/colosseum/user";

const NoAuthView = () => (
  <div className="flex flex-col items-center">
    <div className="flex flex-row items-center text-4xl font-semibold space-x-2">
      <LandmarkIcon size={48} />
      <h1>Welcome to Colosseum.</h1>
    </div>
    <p className="text-muted-foreground">
      Account creation is currently invite only.
    </p>
    <Link
      href="/auth/login"
      className="flex flex-row items-center justify-center mt-4 space-x-1"
    >
      <p className="underline">Login</p>
      <ArrowRight size={16} />
    </Link>
  </div>
);

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // if there is no user, immediately show the sign-in view

  if (!user) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center">
        <div className="flex flex-row items-center text-4xl font-semibold space-x-2">
          <LandmarkIcon size={48} />
          <h1>Welcome to Colosseum.</h1>
        </div>
        <p className="text-muted-foreground">
          Account creation is currently invite only.
        </p>
        <Link
          href="/auth/login"
          className="flex flex-row items-center justify-center mt-4 space-x-1"
        >
          <p className="underline">Login</p>
          <ArrowRight size={16} />
        </Link>
      </main>
    );
  }

  // get the user handle and redirect to the user's profile

  const userProfile = await getUserProfile(supabase, user.id);

  redirect(`/${userProfile?.handle}`);
}
