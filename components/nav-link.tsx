"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// A text link in the top nav. On its own route it turns full ink and semibold
// and carries aria-current, so the nav says where you are.
export function NavLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const current = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex h-9 items-center rounded-md px-2 text-sm underline-offset-4 focus-ring hover:underline coarse:h-11",
        current ? "font-semibold text-foreground" : "link-subtle font-medium",
        className,
      )}
    >
      {children}
    </Link>
  );
}
