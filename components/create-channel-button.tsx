"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import CreateChannelForm from "./create-channel-form";

export default function CreateChannelButton() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <PlusIcon />
          Create channel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create channel</DialogTitle>
          <DialogDescription>Start stashing your web.</DialogDescription>
        </DialogHeader>
        {/* Navigates to the new channel on success, which unmounts this modal. */}
        <CreateChannelForm />
      </DialogContent>
    </Dialog>
  );
}
