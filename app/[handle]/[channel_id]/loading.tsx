import { Skeleton } from "@/components/ui/skeleton";

// Instant-navigation shell for a channel board. Appears immediately on click
// while the server resolves the channel and its stats; mirrors channel-board's
// header, meta block, and grid so the real board swaps in without layout shift.
export default function Loading() {
  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <Skeleton className="h-9 w-72" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-9 w-9" />
      </div>
      <div className="flex flex-col space-y-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-2/3 max-w-lg" />
      </div>
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    </div>
  );
}
