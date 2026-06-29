import { getUserProfile } from "@/lib/colosseum/user";
import { createClient } from "@/lib/supabase/server";
import { LandmarkIcon, ArrowRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import { ThemeSwitcher } from "./theme-switcher";
import { LogoutButton } from "./logout-button";

export default async function NavBar() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <nav className="w-full flex justify-between p-4">
        <Link href="/">
          <LandmarkIcon />
        </Link>
        <div className="flex flex-row space-x-2 items-center">
          <Link href="/auth/login" className="flex flex-row items-center justify-center space-x-1">
            <p className="underline">Login</p>
            <ArrowRight size={16} />
          </Link>
          <ThemeSwitcher />
        </div>
      </nav>
    );
  }
  // get the user profile to get the avatar. A user who hasn't completed
  // onboarding has no profile yet, so render the nav without the avatar.
  const userProfile = await getUserProfile(supabase, user.id);

  return (
    <nav className="w-full flex justify-between p-4">
      <Link href="/">
        <LandmarkIcon />
      </Link>
      <div className="flex flex-row space-x-2 items-center">
        {userProfile && (
          <Link href="/settings">
            <Avatar>
              <AvatarImage src={userProfile.avatar_url} />
              <AvatarFallback>{userProfile.handle.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
        )}
        <ThemeSwitcher />
        <LogoutButton />
      </div>
    </nav>
  );
}
