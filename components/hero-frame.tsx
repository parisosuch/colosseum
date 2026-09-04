"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import BrailleImage from "@/components/braille-image";
import { Logo } from "@/components/logo";
import { HERO_ROUTES } from "@/lib/hero-routes";

// The hero shell lives here in the root layout (not in each page) so the
// Braille mark stays mounted across soft navigations between hero routes
// instead of remounting — animation and all. Pages render only their
// right-hand content into the slot.
export function HeroFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!HERO_ROUTES.has(pathname)) return children;
  return (
    <main className="flex-1 flex flex-col overflow-y-auto px-6 py-8 md:px-16">
      {/* The nav is dropped on the hero routes, so without this the only way
          off /auth/login or /auth/sign-up is the browser's Back button. The
          landing page is already home, so it doesn't get one. */}
      {pathname === "/" ? null : (
        <Link
          href="/"
          aria-label="Colosseum home"
          className="-ml-2 mb-4 flex size-11 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground hover:text-foreground focus-ring"
        >
          <Logo className="h-4 w-auto" />
        </Link>
      )}
      <div className="flex flex-1 flex-col md:flex-row items-center justify-center gap-8 md:gap-12">
        {/* interactive Braille mark: above the content on mobile, beside it on desktop */}
        <div className="flex w-full md:w-auto md:flex-1 items-center justify-center overflow-hidden bg-primary p-6 md:p-8 rounded-md h-48 md:h-auto md:min-h-[48rem]">
          {/* The mark renders at a fixed ~624×340px; scale it down so the whole
              thing fits the short mobile panel. ponytail: eyeballed, bump if it
              crops. */}
          <div className="scale-[0.4] md:scale-100">
            <BrailleImage />
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
