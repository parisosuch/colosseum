"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import { Channel, updateChannel } from "@/lib/colosseum/channel";
import { Pencil } from "lucide-react";

export default function EditChannelButton({
  channel,
  onUpdated,
}: {
  channel: Channel;
  onUpdated: (channel: Channel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(channel.title);
  const [description, setDescription] = useState(channel.description ?? "");
  const [isPrivate, setPrivate] = useState(channel.private);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <p>Edit channel</p>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Edit channel</DialogTitle>
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
      </DialogContent>
    </Dialog>
  );
}
