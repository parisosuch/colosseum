"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, LayersIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { addChannelColumnAction, getMyProfileAction } from "@/lib/colosseum/actions";
import type { PickableChannel } from "@/components/add-block-drawer";
import type { Channel } from "@/lib/colosseum/channel";
import CreateChannelForm from "@/components/create-channel-form";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Are.na-style "connect this channel to one of mine": nests the current
// (public) channel as a column inside a channel the viewer owns, or into one
// created on the spot. `channels` is the viewer's own channels; the caller only
// renders this for a signed-in viewer, so an empty list still gets the button —
// having nowhere to connect to is exactly when creating a channel is the point.
export default function ConnectChannelButton({
  channelId,
  channels,
}: {
  channelId: number;
  channels: PickableChannel[];
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const router = useRouter();

  // Can't connect a channel to itself.
  const targets = channels.filter((c) => c.id !== channelId);

  const handleConnect = async (hostChannelId: number) => {
    if (connecting) return;
    setConnecting(true);
    try {
      await addChannelColumnAction(channelId, hostChannelId);
      setOpen(false);
      toast.success("Connected to channel.");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't connect to that channel. Please try again.");
    } finally {
      setConnecting(false);
    }
  };

  // Create-then-connect is two writes. If the connect fails the channel still
  // exists, so open it rather than leaving behind an empty one nobody saw.
  const handleCreated = async (channel: Channel) => {
    try {
      await addChannelColumnAction(channelId, channel.id);
      setCreating(false);
      toast.success("Connected to channel.");
      // The picker's channel list is server-rendered, so pull the new one in.
      router.refresh();
    } catch (e) {
      console.error(e);
      toast.error("Channel created, but connecting failed. Opening the new channel.");
      const profile = await getMyProfileAction();
      if (profile) router.push(`/${profile.handle}/${channel.id}`);
      setCreating(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Connect to another channel"
            onClick={() => setOpen(true)}
          >
            <ArrowRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Connect to another channel</TooltipContent>
      </Tooltip>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Connect to channel"
        description="Connect this channel as a column in one of your channels."
      >
        <CommandInput placeholder="Search your channels…" />
        <CommandList>
          <CommandEmpty>No channels found.</CommandEmpty>
          {targets.map((c) => (
            <CommandItem
              key={c.id}
              value={`channel-${c.id}`}
              keywords={[c.title]}
              disabled={connecting}
              onSelect={() => handleConnect(c.id)}
            >
              <LayersIcon />
              <span className="truncate">{c.title}</span>
              {c.private ? (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">private</span>
              ) : null}
            </CommandItem>
          ))}
          <CommandItem
            value="new-channel"
            disabled={connecting}
            forceMount
            onSelect={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            <PlusIcon />
            <span>New channel…</span>
          </CommandItem>
        </CommandList>
      </CommandDialog>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New channel</DialogTitle>
          </DialogHeader>
          <CreateChannelForm submitLabel="Create and connect" onCreated={handleCreated} />
        </DialogContent>
      </Dialog>
    </>
  );
}
