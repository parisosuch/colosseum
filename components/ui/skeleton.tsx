import { cn } from "@/lib/utils";

// Placeholder block used by route loading shells (app/**/loading.tsx) to mirror
// a page's layout while the server render streams in. Matches the inline
// `bg-muted animate-pulse` skeletons used in channel-board.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
