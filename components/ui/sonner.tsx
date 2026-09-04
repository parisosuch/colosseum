"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    // No richColors: it paints the surface from sonner's own palette, which is
    // hardcoded hsl() in node_modules and so answers neither the theme tokens
    // nor the prefers-contrast block in app/globals.css. Toasts instead sit on
    // the app's popover surface like every other floating panel, and the type
    // icons below carry the semantics — error on the same red as inline form
    // errors, so one red means danger everywhere.
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Both offsets, not just the mobile one: sonner's mobile breakpoint
      // (600px) sits below the one that hides the bottom bar (640px), so the
      // desktop offset is what applies in between while the bar is still on
      // screen. --toast-offset-bottom resolves per breakpoint and per whether
      // the bar is mounted; see app/globals.css.
      offset={{ bottom: "var(--toast-offset-bottom)" }}
      mobileOffset={{ bottom: "var(--toast-offset-bottom)" }}
      icons={{
        success: <CircleCheckIcon className="size-4 text-emerald-500" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-500" />,
        error: <OctagonXIcon className="size-4 text-destructive-text" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // hsl(), not the bare token: --popover and friends hold a raw "0 0% 100%"
      // triplet, so handing sonner the var directly produced an invalid value
      // and the declaration was dropped. Every call site is typed, so with
      // richColors on nothing read --normal-* and the breakage stayed hidden.
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
