import { Skeleton } from "@/components/ui/skeleton";

// Instant-navigation shell for a user's profile page. Next renders this the
// moment a profile link is clicked, so the layout appears immediately while the
// server fetches the profile and channels (which stream in to replace it).
// Mirrors app/[handle]/page.tsx's container and structure to minimize shift.
export default function Loading() {
  return (
    <div className="w-full flex-1 p-6 sm:p-12 space-y-8">
      <Skeleton className="h-9 w-56" />
      <div className="flex flex-col space-y-4">
        {/* UserProfilePicture size="xl" — the page's first element, 64px. */}
        <div>
          <Skeleton className="size-16 rounded-full" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-3/4 max-w-md" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      {/* ChannelsView's toolbar: create + search left, sort / filter / view
          toggle right. Wraps below sm exactly as the real one does. */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-full sm:w-64" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-9 w-11 sm:w-44" />
            <Skeleton className="h-9 w-11 sm:w-24" />
            <Skeleton className="h-9 w-[70px]" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:flex md:flex-col md:space-y-4 md:gap-0">
          {Array.from({ length: 3 }).map((_, i) => (
            // md: border-2 + p-8 around ChannelColumnsView's p-2 and 250px strip.
            <Skeleton key={i} className="aspect-square rounded-lg md:aspect-auto md:h-[334px]" />
          ))}
        </div>
      </div>
    </div>
  );
}
