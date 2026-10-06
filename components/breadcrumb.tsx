import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { splitTrail, type Crumb, type TrailParent } from "./breadcrumb-trail";

export type { Crumb } from "./breadcrumb-trail";

// A parent in the trail. Long labels truncate at a max width the caller sets
// and keep the full text in a tooltip; the flex row they sit in has min-w-0,
// so the parents share whatever room there is.
function TrailItem({ crumb, className }: { crumb: TrailParent; className: string }) {
  const base = cn("block min-w-0 truncate rounded-sm font-medium", className);
  return crumb.href ? (
    <Link
      href={crumb.href}
      title={crumb.label}
      className={cn(base, "link-subtle underline-offset-4 focus-ring hover:underline")}
    >
      {crumb.label}
    </Link>
  ) : (
    <span title={crumb.label} className={cn(base, "text-muted-foreground")}>
      {crumb.label}
    </span>
  );
}

function Separator({ className }: { className?: string }) {
  return <ChevronRight aria-hidden className={cn("shrink-0 text-muted-foreground", className)} />;
}

// The breadcrumb, in two sizes.
//
// The page form opens every page: a small sans trail of parents, each followed
// by a chevron, above the serif title. Parents truncate at 480px (120px on a
// phone); the title wraps, breaking a URL wherever it has to, and stops at four
// lines on a phone. On a touch screen each parent is a 44px row.
//
// The compact form sits in the canvas's floating island. From `sm` up the
// trail is a caption line over the title; below it the island keeps one row,
// so only the nearest parent shows and the back button covers the rest.
//
// Either way the trail is a nav landmark, and the current page is the title,
// marked aria-current and never a link.
export function Breadcrumb({
  crumbs,
  compact = false,
}: {
  crumbs: readonly Crumb[];
  compact?: boolean;
}) {
  const { parents, current } = splitTrail(crumbs);
  if (current === null) return null;

  if (compact) {
    return (
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1 px-1 sm:flex-col sm:items-start sm:gap-0"
      >
        {parents.length > 0 ? (
          <>
            <ol className="flex min-w-0 items-center gap-0.5">
              {parents.map((crumb, i) => {
                const nearest = i === parents.length - 1;
                return (
                  <li
                    key={`${crumb.href}:${crumb.label}`}
                    className={cn(
                      "flex min-w-0 items-center gap-0.5",
                      !nearest && "hidden sm:flex",
                    )}
                  >
                    <TrailItem
                      crumb={crumb}
                      className="max-w-[7.5rem] text-sm max-sm:py-3 sm:max-w-[11.25rem] sm:text-xs"
                    />
                    {nearest ? null : <Separator className="size-3" />}
                  </li>
                );
              })}
            </ol>
            <Separator className="size-4 sm:hidden" />
          </>
        ) : null}
        <span
          aria-current="page"
          title={current}
          className="block max-w-[8rem] truncate font-serif text-lg leading-7 sm:max-w-[16rem]"
        >
          {current}
        </span>
      </nav>
    );
  }

  return (
    <div className="flex flex-col gap-2 coarse:gap-0">
      {parents.length > 0 ? (
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1">
            {parents.map((crumb) => (
              <li key={`${crumb.href}:${crumb.label}`} className="flex min-w-0 items-center gap-1">
                <TrailItem
                  crumb={crumb}
                  className="max-w-[7.5rem] text-sm coarse:py-3 sm:max-w-[30rem]"
                />
                <Separator className="size-4" />
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <h1 aria-current="page" className="text-display line-clamp-4 break-words sm:line-clamp-none">
        {current}
      </h1>
    </div>
  );
}
