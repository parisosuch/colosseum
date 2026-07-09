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
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-3/4 max-w-md" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:flex md:flex-col md:space-y-4 md:gap-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg md:aspect-auto md:h-[250px]" />
        ))}
      </div>
    </div>
  );
}
