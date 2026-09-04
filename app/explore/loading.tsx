import { Skeleton } from "@/components/ui/skeleton";

// Instant-navigation shell for the Explore feed. The real page awaits the
// activity query and its screenshot lookups, which is long enough that without
// this the previous route just sits there. Mirrors explore-view's rhythm: the
// breadcrumb, the blurb, then a centred gap-16 column of cards, each an
// attribution line (text-title, ~32px) over a timestamp and a square focal card.
export default function Loading() {
  return (
    <div className="w-full flex-1 p-6 sm:p-12 space-y-8">
      {/* PageHeader breadcrumb (h1.text-display: text-2xl → sm:text-4xl). */}
      <div className="flex h-8 items-center sm:h-10">
        <Skeleton className="h-7 w-40" />
      </div>

      <div className="space-y-1">
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>

      <div className="flex flex-col items-center gap-16">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mx-auto flex w-full max-w-md flex-col gap-4">
            <div className="flex flex-col items-center gap-1">
              <Skeleton className="h-8 w-64 max-w-full" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="aspect-square w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
