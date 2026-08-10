"use client";

import { useState } from "react";
import Link from "next/link";
import { HomeIcon, SearchIcon } from "lucide-react";

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { MobileSearch } from "@/components/mobile-search";
import { AddBlockDrawer, type PickableChannel } from "@/components/add-block-drawer";
import { ProfileDrawer } from "@/components/profile-drawer";

const ITEM =
  "flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring";

// The Are.na-style bottom tab bar for mobile: Home, Search, the "+" add-block
// flow, and the profile menu (which replaces the top avatar menu on mobile).
// Every action opens a bottom drawer. Rendered as the last flex child of the
// app shell and hidden at `sm` and up.
export function MobileBottomBar({
  handle,
  avatarUrl,
  isAdmin,
  channels,
}: {
  handle: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  channels: PickableChannel[];
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    // data-mobile-bottom-bar is what globals.css looks for to lift toasts
    // above the bar; it's only in the DOM when the bar actually renders.
    <nav
      data-mobile-bottom-bar
      className="chrome fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <div className="flex h-14 items-center justify-around px-2">
        <Link href="/" aria-label="Home" className={ITEM}>
          <HomeIcon />
        </Link>

        <button
          type="button"
          aria-label="Search"
          className={ITEM}
          onClick={() => setSearchOpen(true)}
        >
          <SearchIcon />
        </button>

        <AddBlockDrawer channels={channels} />

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
