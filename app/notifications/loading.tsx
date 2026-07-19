import { Skeleton } from "@/components/ui/skeleton";

// Instant-navigation shell for the notifications page. Mirrors the real layout
// so the feed swaps in without shifting: breadcrumb at the left edge, then a
// centered column with the header (title + controls) and a group of rows whose
// avatar + two text lines track notification-list's Row.
export default function Loading() {
  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      {/* PageHeader breadcrumb (h1.text-display: text-2xl → sm:text-4xl). */}
      <div className="flex h-8 items-center sm:h-10">
        <Skeleton className="h-7 w-64" />
      </div>

      <div className="mx-auto w-full max-w-2xl space-y-6">
        {/* Header: "Notifications" title + filter / mark-all-read controls. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-7 w-44" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>

        {/* One day group: label + a bordered, divided list of rows. */}
        <div className="space-y-3">
          <Skeleton className="h-3 w-16" />
          <div className="divide-y overflow-hidden rounded-xl border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
