"use client";

import { MenuIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserMenuItems } from "@/components/user-menu";

// Mobile nav menu: a hamburger that opens the same menu the desktop avatar does
// (Settings, Invites, Theme, Logout). Replaces the avatar menu on mobile — the
// nav renders this at `sm:hidden` and the avatar UserMenu at `hidden sm:flex`,
// so exactly one shows per breakpoint.
export function MobileMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Menu"
        className="flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MenuIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <UserMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
