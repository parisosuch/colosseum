"use client";

import { useState } from "react";
import { UsersIcon } from "lucide-react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import CreateGroupForm from "./create-group-form";

export default function CreateGroupButton({
  variant = "secondary",
}: {
  variant?: "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <UsersIcon />
          Create group
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create group</DialogTitle>
          <DialogDescription>
            A shared handle, with channels that belong to everyone in it.
          </DialogDescription>
        </DialogHeader>
        {/* Navigates to the new group on success, which unmounts this modal. */}
        <CreateGroupForm />
      </DialogContent>
    </Dialog>
  );
}
