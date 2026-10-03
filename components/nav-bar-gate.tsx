"use client";

import { usePathname } from "next/navigation";

import { isCanvasPath } from "@/lib/canvas/route";
// Loaded with the root layout so its popstate listener is added before Next's.
import "@/lib/canvas/popstate-gate";
import { HERO_ROUTES } from "@/lib/hero-routes";

// The nav is rendered on the server in the root layout; this drops it on the
// hero routes and the canvas page without threading the pathname through a
// server component.
export function NavBarGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return HERO_ROUTES.has(pathname) || isCanvasPath(pathname) ? null : children;
}

// The mobile bottom bar stays on the canvas: at phone width it's where
// notifications and the account menu live, there as on every other page.
export function MobileBarGate({ children }: { children: React.ReactNode }) {
  return HERO_ROUTES.has(usePathname()) ? null : children;
}
