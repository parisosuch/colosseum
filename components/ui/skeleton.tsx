import { cn } from "@/lib/utils";

// The one loading placeholder: route shells (app/**/loading.tsx) and the
// channel board both mirror their layout with it while the server render
// streams in. Pass sizing through className — the pulse, the muted fill and the
// corner radius are the parts that have to agree, since the two render adjacent
// to each other during a single streaming pass.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
