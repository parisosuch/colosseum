"use client";

import { usePathname } from "next/navigation";

import { HERO_ROUTES } from "@/lib/hero-routes";

// The nav is rendered on the server in the root layout; this drops it on the
// hero routes without threading the pathname through a server component.
export function NavBarGate({ children }: { children: React.ReactNode }) {
  return HERO_ROUTES.has(usePathname()) ? null : children;
}
