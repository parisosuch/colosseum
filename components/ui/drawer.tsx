"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";

function Drawer({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 ![animation-duration:var(--duration-panel)] [animation-timing-function:var(--ease-out)] data-[state=closed]:![animation-duration:var(--duration-ui)] data-[state=closed]:[animation-timing-function:var(--ease-in)]",
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      {/* Bottom sheet. We only use bottom drawers, so position is hardcoded
          rather than gated behind `data-[vaul-drawer-direction=…]` variants —
          those left the panel unpositioned (overlay dimmed, no visible sheet). */}
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          // dvh (not vh): in an iOS standalone PWA vh resolves against the
          // large layout viewport, so the sheet oversizes and vaul's
          // input-repositioning snaps it. dvh follows the browser's own chrome.
          //
          // It does not follow the software keyboard, though — on iOS that
          // shrinks the visual viewport and leaves the layout viewport alone,
          // so a sheet capped in dvh alone keeps its full height and its lower
          // half sits under the keyboard. --visual-vh is the height that does
          // shrink (see VisualViewportVar); min() takes whichever is smaller,
          // and falls back to the dvh cap wherever the variable is absent.
          //
          // Capping the height is only half of it. The sheet is anchored to the
          // *layout* viewport's bottom edge, which the keyboard sits over, so a
          // shorter sheet stays exactly as buried as a tall one — it has to be
          // lifted by what the keyboard covers as well.
          "bg-background fixed inset-x-0 bottom-[var(--keyboard-inset,0px)] z-50 mt-24 flex h-auto max-h-[min(80dvh,var(--visual-vh,80dvh))] flex-col rounded-t-lg border-t",
          className,
        )}
        {...props}
      >
        <div className="bg-muted mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
