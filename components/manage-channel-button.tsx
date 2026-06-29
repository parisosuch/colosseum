"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import { Channel, deleteChannel, updateChannel } from "@/lib/colosseum/channel";
import { Settings, Trash2 } from "lucide-react";

export default function ManageChannelButton({
  channel,
  handle,
  onUpdated,
}: {
  channel: Channel;
  handle: string;
  onUpdated: (channel: Channel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(channel.title);
  const [description, setDescription] = useState(channel.description ?? "");
  const [isPrivate, setPrivate] = useState(channel.private);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  // Reset the form to the current channel whenever the dialog opens, so a
  // cancelled edit doesn't leave stale values behind on the next open.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setTitle(channel.title);
      setDescription(channel.description ?? "");
      setPrivate(channel.private);
      setError(null);
    }
    setOpen(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const updated = await updateChannel(supabase, channel.id, {
        title,
        description,
        private: isPrivate,
      });
      onUpdated(updated);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const supabase = createClient();
      await deleteChannel(supabase, channel.id);
      // The channel page is gone; send the owner back to their profile.
      router.push(`/${handle}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Settings />
          <p>Manage channel</p>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Manage channel</DialogTitle>
        <DialogDescription>Update your channel’s details.</DialogDescription>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Label htmlFor="edit-description">Description</Label>
            <Input
              id="edit-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="edit-private"
                checked={isPrivate}
                onCheckedChange={(state) => setPrivate(state === true)}
              />
              <Label htmlFor="edit-private">Private channel</Label>
            </div>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Saving..." : "Save changes"}
          </Button>
        </form>

        <div className="border-t pt-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full border-destructive bg-transparent text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 />
                <p>Delete channel</p>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this channel?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the channel and all of its blocks. This can’t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isDeleting}
                  onClick={(e) => {
                    // Keep the dialog open until the delete + redirect resolves.
                    e.preventDefault();
                    handleDelete();
                  }}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </DialogContent>
    </Dialog>
  );
}
