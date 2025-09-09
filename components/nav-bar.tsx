import { getUserProfile } from "@/lib/colosseum/user";
import { createClient } from "@/lib/supabase/server";
import { LandmarkIcon, ArrowRight } from "lucide-react";
import Link from "next/link";

export default async function NavBar() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <nav className="w-full flex justify-between p-4">
        <LandmarkIcon />
        <Link
          href="/auth/login"
          className="flex flex-row items-center justify-center space-x-1"
        >
          <p className="underline">Login</p>
          <ArrowRight size={16} />
        </Link>
      </nav>
    );
  }
  // get the user profile to get the avatar
  const userProfile = await getUserProfile(supabase, user.id);

  return (
    <nav className="w-full flex justify-between p-4">
      <LandmarkIcon />
      <Link
        href="/auth/login"
        className="flex flex-row items-center justify-center space-x-1"
      ></Link>
    </nav>
  );
}
