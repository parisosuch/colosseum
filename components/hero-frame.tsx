"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import BrailleImage from "@/components/braille-image";
import { Logo } from "@/components/logo";
import { HERO_ROUTES } from "@/lib/hero-routes";
import { cn } from "@/lib/utils";

// The hero shell lives here in the root layout (not in each page) so the
// Braille mark stays mounted across soft navigations between hero routes
// instead of remounting — animation and all. Pages render only their
// right-hand content into the slot.
//
// Every hero route gets the same header, plate and footer row, so the plate
// is the same size on each and the mark doesn't move between them. Only the
// landing page puts a line in the footer; the others keep the row empty on
// desktop for that reason.
export function HeroFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (!HERO_ROUTES.has(pathname)) return children;
  const isLanding = pathname === "/";
  const brand = (
    <>
      <Logo aria-hidden className="h-6 w-10" />
      <span className="text-heading">Colosseum</span>
    </>
  );
  return (
    <main className="flex flex-1 flex-col px-6 pb-8 pt-4 lg:px-16 lg:py-8">
      <div className="mx-auto flex w-full max-w-[82rem] flex-1 flex-col gap-8 lg:justify-between lg:gap-6">
        {/* The nav is dropped on the hero routes, so without this link the
            only way off /auth/login or /auth/sign-up is the browser's Back
            button. The landing page is already home, so there it's a label. */}
        <header className="flex h-11 shrink-0 items-center">
          {isLanding ? (
            <div className="flex items-center gap-3">{brand}</div>
          ) : (
            <Link
              href="/"
              aria-label="Colosseum home"
              className="-mx-2 flex h-11 items-center gap-3 rounded-md px-2 focus-ring"
            >
              {brand}
            </Link>
          )}
        </header>
        <div className="flex flex-1 flex-col items-center gap-8 lg:max-h-[47.5rem] lg:flex-row lg:gap-16">
          {/* The Braille mark on the primary plate: above the content on
              mobile, beside it from lg, where it takes the full height of the
              row. The row stops growing at 760px on tall screens and sits
              centred between the header and footer. The mark scales itself
              down to fit the plate. */}
          <div className="h-56 w-full shrink-0 overflow-hidden rounded-md bg-primary p-3 sm:h-80 lg:h-auto lg:min-w-0 lg:flex-1 lg:self-stretch lg:p-8">
            <BrailleImage />
          </div>
          <div className="w-full max-w-xl lg:w-[30rem] lg:max-w-none lg:shrink-0">{children}</div>
        </div>
        <footer
          className={cn("text-caption lg:min-h-4 lg:shrink-0", !isLanding && "hidden lg:block")}
        >
          {isLanding
            ? "Colosseum is open source. Run it on your own server, or reach it through the API."
            : null}
        </footer>
      </div>
    </main>
  );
}
