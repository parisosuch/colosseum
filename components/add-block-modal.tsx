"use client";

import { PlusIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AddBlockBody, useAddBlockFlow, type PickableChannel } from "@/components/add-block-flow";

// The desktop nav "Add +": the same quick-add flow as the mobile drawer, in a
// centred dialog instead of a bottom sheet. `p-0 gap-0` strips the dialog's
// default padding so the shared body's own px-4 lines up with the header.
export function AddBlockModal({
  channels,
  label = "Add",
}: {
  channels: PickableChannel[];
  label?: string;
}) {
  const flow = useAddBlockFlow(channels);

  return (
    <Dialog open={flow.open} onOpenChange={flow.onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          {label}
          <PlusIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-4 pb-3 pt-4">
          <DialogTitle>{flow.title}</DialogTitle>
        </DialogHeader>
        <AddBlockBody flow={flow} advanceOnEnter />
      </DialogContent>
    </Dialog>
  );
}
