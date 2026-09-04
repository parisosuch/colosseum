"use client";

import { PlusIcon } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { AddBlockBody, useAddBlockFlow, type PickableChannel } from "@/components/add-block-flow";
import { TAB, TabLabel } from "@/components/mobile-tab";

export type { PickableChannel };

// The mobile bottom-bar "+": the shared quick-add flow in a bottom-sheet shell.
// Desktop uses AddBlockModal for the same flow in a centred dialog.
export function AddBlockDrawer({ channels }: { channels: PickableChannel[] }) {
  const flow = useAddBlockFlow(channels);

  return (
    <Drawer open={flow.open} onOpenChange={flow.onOpenChange}>
      {/* The trigger is one of the bottom bar's tabs, so it wears the same
          shape as its siblings. "Add" is the visible half of "Add column". */}
      <DrawerTrigger aria-label="Add column" className={TAB}>
        <PlusIcon />
        <TabLabel>Add</TabLabel>
      </DrawerTrigger>
      {/* A fixed height, not one that follows the content. vaul caches the
          sheet's height the first time the soft keyboard opens and writes it
          back as an inline style when the keyboard closes, so a sheet that
          grows between steps gets pinned to whatever it measured on the first
          step and clips the second. Same height throughout means that cached
          measurement is always the right one. */}
      <DrawerContent className="h-[70dvh]">
        <DrawerHeader>
          <DrawerTitle>{flow.title}</DrawerTitle>
        </DrawerHeader>
        <AddBlockBody flow={flow} tall />
      </DrawerContent>
    </Drawer>
  );
}
