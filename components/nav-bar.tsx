import { getUserProfile } from "@/lib/colosseum/user";
import { getUserChannels } from "@/lib/colosseum/channel";
import { unreadNotificationCount } from "@/lib/colosseum/notification";
import { getSessionUser } from "@/lib/auth";
import { ArrowRight, Bell } from "lucide-react";
import Link from "next/link";
import { Button } from "./ui/button";
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
        {/* Login is the app's only conversion action, so it's the same filled
            button the landing page uses, far enough from the theme control
            that the two error zones don't touch. */}
        <div className="flex flex-row gap-3 items-center">
          <Button asChild>
            <Link href="/auth/login">
              Login
              <ArrowRight />
            </Link>
          </Button>
          <ThemeSwitcher />
        </div>
      </nav>
    );
  }
  // get the user profile to get the avatar. A user who hasn't completed
  // onboarding has no profile yet, so render the nav without the avatar.
  const userProfile = await getUserProfile(user.id);

  // Both only need the profile to exist, and neither needs the other. The nav
  // renders in the root layout, so serializing them adds latency to every route.
  // The quick-add drawer needs the viewer's channels to pick a destination;
  // only onboarded users see it, so skip both queries otherwise.
  const [ownChannels, unread] = await Promise.all([
    userProfile ? getUserChannels(user.id) : Promise.resolve([]),
    userProfile ? unreadNotificationCount(user.id) : Promise.resolve(0),
  ]);

  const channels = ownChannels.map((c) => ({
    id: c.id,
    title: c.title,
    private: c.private,
  }));

  return (
    <nav className="chrome sticky top-0 z-40 w-full flex justify-between p-4">
      <Link href="/">
        <Logo className="h-6 w-auto" />
      </Link>
      {userProfile ? (
        <>
          <div className="hidden sm:flex flex-1 max-w-md items-center gap-2">
            <div className="flex-1 max-w-xs">
              <SearchBar />
            </div>
            <AddBlockModal channels={channels} label="Add" />
          </div>
          <CommandPalette handle={userProfile.handle} />
        </>
      ) : null}
      <div className="flex flex-row space-x-2 items-center">
        {/* Notifications are a bottom-bar tab on mobile, the way the avatar
            menu below is, so the two don't compete for the same corner. The
            badge hangs off the icon rather than the link, which keeps it
            inside the hit area instead of beside it. */}
        {userProfile ? (
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="hidden size-9 items-center justify-center rounded-md coarse:size-11 focus-ring sm:flex"
          >
            <span className="relative">
              <Bell className="size-5" />
              {unread > 0 ? (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </span>
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
