"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon, HomeIcon, SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { MobileSearch } from "@/components/mobile-search";
import { AddBlockDrawer, type PickableChannel } from "@/components/add-block-drawer";
import { ProfileDrawer } from "@/components/profile-drawer";
import { TAB, TAB_ACTIVE, TabLabel } from "@/components/mobile-tab";

// The Are.na-style bottom tab bar for mobile: Home, Search, the "+" add-block
// flow, notifications, and the profile menu (which replaces the top avatar menu
// on mobile). Search, "+" and the profile menu open bottom drawers. Rendered as
// the last flex child of the app shell and hidden at `sm` and up.
export function MobileBottomBar({
  handle,
  avatarUrl,
  isAdmin,
  channels,
  unread = 0,
}: {
  handle: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  channels: PickableChannel[];
  unread?: number;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = usePathname();

  // Only the two link tabs have a route to be on; the other three open drawers.
  const routeTab = (href: string) => {
    const active = pathname === href;
    return {
      className: cn(TAB, active && TAB_ACTIVE),
      "aria-current": active ? ("page" as const) : undefined,
    };
  };

  return (
    // data-mobile-bottom-bar is what globals.css looks for to lift toasts
    // above the bar; it's only in the DOM when the bar actually renders.
    <nav
      data-mobile-bottom-bar
      className="chrome fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <div className="flex h-14 items-stretch px-2">
        {/* Explore, not `/`: the bar only renders for signed-in users, and `/`
            redirects them here. Pointing at it directly saves the round trip
            and gives the tab a route it can actually be on. */}
        <Link href="/explore" {...routeTab("/explore")}>
          <HomeIcon />
          <TabLabel>Home</TabLabel>
        </Link>

        <button type="button" className={TAB} onClick={() => setSearchOpen(true)}>
          <SearchIcon />
          <TabLabel>Search</TabLabel>
        </button>

        <AddBlockDrawer channels={channels} />

        <Link href="/notifications" {...routeTab("/notifications")}>
          {/* The badge is placed against the icon rather than the tab, so it
              stays inside the hit area instead of hanging off its corner. */}
          <span className="relative">
            <BellIcon />
            {unread > 0 ? (
              <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </span>
          <TabLabel>Notifications</TabLabel>
        </Link>

        <ProfileDrawer handle={handle} avatarUrl={avatarUrl} isAdmin={isAdmin} />
      </div>

      <Drawer open={searchOpen} onOpenChange={setSearchOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Search</DrawerTitle>
          </DrawerHeader>
          <MobileSearch onClose={() => setSearchOpen(false)} />
        </DrawerContent>
      </Drawer>
    </nav>
  );
}
