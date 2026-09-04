import { Skeleton } from "@/components/ui/skeleton";
import { SKELETON_COUNT } from "@/lib/pagination";

// Instant-navigation shell for a channel board. Appears immediately on click
// while the server resolves the channel and its stats; mirrors channel-board's
// header, action row, meta block, controls, and grid so the real board swaps in
// without shifting down. Heights track the real elements' line boxes; only the
// always-present sections are reserved (tags/members are per-channel, so
// reserving them would over-shoot solo channels and shift up instead).
//
// A route's loading UI takes no props — it renders before the params resolve —
// so it can't know who is looking or how many blocks a channel holds. It
// reserves only what every channel shows: Export and the view toggle (Manage,
// Leave, Connect and the admin delete are each conditional, and four
// placeholders collapsing to one shifted the whole page), and the controls row,
// which every channel that isn't empty has.
export default function Loading() {
  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      {/* PageHeader breadcrumb (h1.text-display: text-2xl → sm:text-4xl). */}
      <div className="flex h-8 items-center sm:h-10">
        <Skeleton className="h-7 w-64" />
      </div>

      {/* Action row: export (h-9 icon) + the view toggle (two 36px segments
          inside a 2px-padded border). */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9" />
        <Skeleton className="h-10 w-[4.75rem]" />
      </div>

      {/* Meta block (flex-col space-y-4): Description label + line, then Meta
          label + three "title … value" rows. */}
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <div className="flex h-4 items-center">
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex h-6 items-center">
            <Skeleton className="h-4 w-2/3 max-w-lg" />
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex h-4 items-center">
            <Skeleton className="h-3 w-12" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex h-6 w-full max-w-[350px] items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>

      {/* Controls row: search + type + sort (all h-9), then the result count. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-full sm:w-64" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-20" />
        </div>
      </div>

      <div className="grid items-start gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          // Mirrors a real grid tile: bordered square + the title and timestamp
          // lines below, so the board swaps in without each tile growing rows.
          <div key={i} className="w-full">
            <Skeleton className="w-full aspect-square rounded-lg border" />
            <div className="pt-1 text-xs">
              <Skeleton className="inline-block h-3 w-2/3 align-middle" />
            </div>
            <div className="text-xs">
              <Skeleton className="inline-block h-3 w-1/3 align-middle" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
