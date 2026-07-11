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

export type { PickableChannel };

// The mobile bottom-bar "+": the shared quick-add flow in a bottom-sheet shell.
// Desktop uses AddBlockModal for the same flow in a centred dialog.
export function AddBlockDrawer({ channels }: { channels: PickableChannel[] }) {
  const flow = useAddBlockFlow(channels);

  return (
    <Drawer open={flow.open} onOpenChange={flow.onOpenChange}>
      <DrawerTrigger
        aria-label="Add column"
        className="flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PlusIcon />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{flow.title}</DrawerTitle>
        </DrawerHeader>
        <AddBlockBody flow={flow} tall />
      </DrawerContent>
    </Drawer>
  );
}
