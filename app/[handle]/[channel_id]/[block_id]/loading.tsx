import { Skeleton } from "@/components/ui/skeleton";

// Instant-navigation shell for a single block. Appears immediately on click
// while the server resolves the block, its channel, and any screenshot; mirrors
// the block page's two-column layout (content + sidebar) to minimize shift.
export default function Loading() {
  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <Skeleton className="h-9 w-80 max-w-full" />
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="w-full lg:w-3/4">
          <Skeleton className="aspect-video w-full rounded-lg" />
        </div>
        <aside className="w-full lg:w-1/4 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
