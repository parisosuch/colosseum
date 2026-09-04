import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// The shape a surface takes when it has nothing to list: a dashed frame around
// a centered icon, one line naming the state, and a second saying what would
// fill it. `children` is an action slot for a link or button pointing at
// whatever creates the first item — an empty surface a new user lands on should
// tell them where to go next.
function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  icon: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed py-20 text-center",
        className,
      )}
      {...props}
    >
      <Icon className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="text-caption">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export { EmptyState };
