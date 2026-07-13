"use client";

import { useState } from "react";
import { ArrowRight, LayersIcon } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Are.na-style "connect this channel to one of mine": nests the current
// (public) channel as a column inside a channel the viewer owns. Renders nothing
// when there's nowhere to connect it (signed out, or the current channel is the
// viewer's only one). `channels` is the viewer's own channels.
export default function ConnectChannelButton({
  channelId,
  channels,
}: {
  channelId: number;
  channels: PickableChannel[];
}) {
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Can't connect a channel to itself.
  const targets = channels.filter((c) => c.id !== channelId);
  if (targets.length === 0) return null;

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
        </CommandList>
      </CommandDialog>
    </>
  );
}
