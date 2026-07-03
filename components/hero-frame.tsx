"use client";

import { usePathname } from "next/navigation";

import BrailleImage from "@/components/braille-image";
import { HERO_ROUTES } from "@/lib/hero-routes";

// The hero shell lives here in the root layout (not in each page) so the
// Braille mark stays mounted across soft navigations between hero routes
// instead of remounting — animation and all. Pages render only their
// right-hand content into the slot.
export function HeroFrame({ children }: { children: React.ReactNode }) {
  if (!HERO_ROUTES.has(usePathname())) return children;
  return (
    <main className="flex-1 flex flex-col md:flex-row items-center justify-center gap-8 md:gap-12 overflow-y-auto px-6 py-8 md:px-16">
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
    </main>
  );
}
