"use client";

import { useState } from "react";
import Link from "next/link";
import { HomeIcon, SearchIcon } from "lucide-react";

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import SearchBar from "@/components/search-bar";
import { AddBlockDrawer, type PickableChannel } from "@/components/add-block-drawer";
import { ProfileDrawer } from "@/components/profile-drawer";

const ITEM =
  "flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring";

// The Are.na-style bottom tab bar for mobile: Home, Search, the "+" add-block
// flow, and the profile menu (which replaces the top avatar menu on mobile).
// Every action opens a bottom drawer. Rendered as the last flex child of the
// app shell and hidden at `sm` and up.
export function MobileBottomBar({
  userId,
  handle,
  avatarUrl,
  channels,
}: {
  userId: string;
  handle: string;
  avatarUrl?: string;
  channels: PickableChannel[];
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <nav className="shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)] sm:hidden">
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

        <ProfileDrawer handle={handle} avatarUrl={avatarUrl} />
      </div>

      <Drawer open={searchOpen} onOpenChange={setSearchOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Search</DrawerTitle>
          </DrawerHeader>
          {/* Room below the input for the results dropdown, which renders
              absolutely under it. */}
          <div className="min-h-[55vh] px-4 pb-4">
            <SearchBar userId={userId} handle={handle} />
          </div>
        </DrawerContent>
      </Drawer>
    </nav>
  );
}
