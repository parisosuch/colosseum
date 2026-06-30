import { getUserProfile } from "@/lib/colosseum/user";
import { createClient } from "@/lib/supabase/server";
import { LandmarkIcon, ArrowRight } from "lucide-react";
import Link from "next/link";
import SearchBar from "./search-bar";
import { ThemeSwitcher } from "./theme-switcher";
import { UserMenu } from "./user-menu";

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
      {userProfile ? (
        <div className="hidden sm:block flex-1 max-w-xs">
          <SearchBar userId={user.id} handle={userProfile.handle} />
        </div>
      ) : null}
      <div className="flex flex-row space-x-2 items-center">
        {/* Theme lives inside the avatar menu; a user who hasn't onboarded yet
            (no profile) has no menu, so fall back to the standalone switcher. */}
        {userProfile ? (
          <UserMenu avatarUrl={userProfile.avatar_url} handle={userProfile.handle} />
        ) : (
          <ThemeSwitcher />
        )}
      </div>
    </nav>
  );
}
