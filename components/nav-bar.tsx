import { getUserProfile } from "@/lib/colosseum/user";
import { getUserChannels } from "@/lib/colosseum/channel";
import { unreadNotificationCount } from "@/lib/colosseum/notification";
import { getSessionUser } from "@/lib/auth";
import { ArrowRight, Bell } from "lucide-react";
import Link from "next/link";
import { AddBlockModal } from "./add-block-modal";
import CommandPalette from "./command-palette";
import { Logo } from "./logo";
import SearchBar from "./search-bar";
import { ThemeSwitcher } from "./theme-switcher";
import { UserMenu } from "./user-menu";

export default async function NavBar() {
  const user = await getSessionUser();
  if (!user) {
    return (
      <nav className="chrome sticky top-0 z-40 w-full flex justify-between p-4">
        <Link href="/">
          <Logo className="h-6 w-auto" />
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
  const userProfile = await getUserProfile(user.id);

  // The quick-add drawer needs the viewer's channels to pick a destination;
  // only onboarded users see it, so skip the query otherwise.
  const channels = userProfile
    ? (await getUserChannels(user.id)).map((c) => ({
        id: c.id,
        title: c.title,
        private: c.private,
      }))
    : [];

  const unread = userProfile ? await unreadNotificationCount(user.id) : 0;

  return (
    <nav className="chrome sticky top-0 z-40 w-full flex justify-between p-4">
      <Link href="/">
        <Logo className="h-6 w-auto" />
      </Link>
      {userProfile ? (
        <>
          <div className="hidden sm:flex flex-1 max-w-md items-center gap-2">
            <div className="flex-1 max-w-xs">
              <SearchBar userId={user.id} />
            </div>
            <AddBlockModal channels={channels} label="Add" />
          </div>
          <CommandPalette handle={userProfile.handle} />
        </>
      ) : null}
      <div className="flex flex-row space-x-2 items-center">
        {userProfile ? (
          <Link href="/notifications" aria-label="Notifications" className="relative p-1">
            <Bell className="size-5" />
            {unread > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Link>
        ) : null}
        {/* Theme lives inside the avatar menu; a user who hasn't onboarded yet
            (no profile) has no menu, so fall back to the standalone switcher.
            On mobile the avatar moves to the bottom bar, so hide it here. */}
        {userProfile ? (
          <div className="hidden sm:block">
            <UserMenu
              avatarUrl={userProfile.avatar_url}
              handle={userProfile.handle}
              isAdmin={user.is_admin}
            />
          </div>
        ) : (
          <ThemeSwitcher />
        )}
      </div>
    </nav>
  );
}
