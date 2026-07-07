"use client";

import { useState } from "react";
import { LayersIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { addChannelColumnAction } from "@/lib/colosseum/actions";
import type { PickableChannel } from "@/components/add-block-drawer";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// Are.na-style "add this channel to one of mine": nests the current (public)
// channel as a column inside a channel the viewer owns. Renders nothing when
// there's nowhere to add it (signed out, or the current channel is the viewer's
// only one). `channels` is the viewer's own channels.
export default function AddChannelToChannelButton({
  channelId,
  channels,
}: {
  channelId: number;
  channels: PickableChannel[];
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  // Can't add a channel to itself.
  const targets = channels.filter((c) => c.id !== channelId);
  if (targets.length === 0) return null;

  const handleAdd = async (hostChannelId: number) => {
    if (adding) return;
    setAdding(true);
    try {
      await addChannelColumnAction(channelId, hostChannelId);
      setOpen(false);
      toast.success("Added to channel.");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't add to that channel. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add to channel
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Add to channel"
        description="Add this channel as a column in one of your channels."
      >
        <CommandInput placeholder="Search your channels…" />
        <CommandList>
          <CommandEmpty>No channels found.</CommandEmpty>
          {targets.map((c) => (
            <CommandItem
              key={c.id}
              value={`channel-${c.id}`}
              keywords={[c.title]}
              disabled={adding}
              onSelect={() => handleAdd(c.id)}
            >
              <LayersIcon />
              <span className="truncate">{c.title}</span>
              {c.private ? (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">private</span>
              ) : null}
            </CommandItem>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
