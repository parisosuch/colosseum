import * as React from "react";

import { cn } from "@/lib/utils";

// A native select styled to match Input, for the places a value is picked from a
// short fixed list (a group's role, a channel's owner). Native rather than a
// Radix listbox because the platform control already handles the keyboard, the
// touch sheet on mobile, and the screen-reader semantics — none of which the
// three call sites need to override.
//
// It exists so those call sites stop hand-rolling the same class string, which
// is what DESIGN.md warns about: each copy had drifted away from Input's
// `focus-ring` and `coarse:min-h-11`, so the control had no visible focus state
// and a sub-44px touch target.
const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          "focus-ring flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 coarse:min-h-11 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = "Select";

export { Select };
