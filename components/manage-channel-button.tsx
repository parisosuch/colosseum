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
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { deleteChannelAction, updateChannelAction } from "@/lib/colosseum/actions";
import type { Channel, ChannelAccess } from "@/lib/colosseum/channel";
import type { ChannelMember } from "@/lib/colosseum/member";
import AccessSelect from "./access-select";
import ChannelMembers from "./channel-members";
import TagInput from "./tag-input";
import { Settings, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

export default function ManageChannelButton({
  channel,
  handle,
  onUpdated,
  members,
  setMembers,
}: {
  channel: Channel;
  handle: string;
  onUpdated: (channel: Channel) => void;
  // Roster state, owned by the board so the members bar and this editor stay in
  // sync as the owner adds/removes people.
  members: ChannelMember[];
  setMembers: Dispatch<SetStateAction<ChannelMember[]>>;
}) {
  const [open, setOpen] = useState(false);
  // Which panel the single dialog is showing.
  const [view, setView] = useState<"manage" | "confirmDelete">("manage");
  const [title, setTitle] = useState(channel.title);
  const [description, setDescription] = useState(channel.description ?? "");
  const [tags, setTags] = useState<string[]>(channel.tags);
  const [access, setAccess] = useState<ChannelAccess>(channel.access);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  // Reset the form (and panel) to the current channel whenever the dialog
  // opens, so a cancelled edit doesn't leave stale values behind next open.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setView("manage");
      setTitle(channel.title);
      setDescription(channel.description ?? "");
      setTags(channel.tags);
      setAccess(channel.access);
      setError(null);
    }
    setOpen(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const updated = await updateChannelAction(channel.id, {
        title,
        description,
        access,
        tags,
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
    setError(null);
    try {
      await deleteChannelAction(channel.id);
      // The channel page is gone; send the owner back to their profile.
      router.push(`/${handle}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="Manage channel">
                <Settings />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>Manage channel</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent>
        {view === "manage" ? (
          <>
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
                <Label>Tags</Label>
                <TagInput tags={tags} onChange={setTags} />
                <div className="pt-1">
                  <AccessSelect value={access} onChange={setAccess} idPrefix="edit-access" />
                </div>
              </div>
              {error && <p className="text-sm text-destructive-text">{error}</p>}
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Saving..." : "Save changes"}
              </Button>
            </form>

            {/* Roster editor. Members can add to public and private channels
                (open channels let anyone add, so the roster is moot there). Owner
                only, which the whole dialog already is. Keyed off the saved
                channel's access, not the unsaved `access` draft. */}
            {channel.access !== "open" ? (
              <ChannelMembers
                channelId={channel.id}
                access={channel.access}
                members={members}
                setMembers={setMembers}
              />
            ) : null}

            <div className="border-t pt-4">
              <Button
                variant="outline"
                // Red type on a transparent ground, so the label takes
                // --destructive-text (contrast-picked for the page background)
                // while the border and hover wash stay on the fill color.
                className="w-full border-destructive bg-transparent text-destructive-text shadow-none hover:bg-destructive/10 hover:text-destructive-text"
                onClick={() => {
                  setError(null);
                  setView("confirmDelete");
                }}
              >
                <Trash2 />
                <p>Delete channel</p>
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogTitle>Delete this channel?</DialogTitle>
            <DialogDescription>
              This permanently deletes the channel and all of its blocks. This can’t be undone.
            </DialogDescription>
            {error && <p className="text-sm text-destructive-text">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={isDeleting} onClick={() => setView("manage")}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={isDeleting} onClick={handleDelete}>
                {isDeleting ? "Deleting..." : "Delete channel"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
