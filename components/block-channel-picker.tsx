"use client";

import { LayersIcon } from "lucide-react";

import type { PickableChannel } from "@/components/add-block-drawer";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// The searchable channel list behind the block modal's Move and Copy buttons.
// Same dialog over the same targets either way — only the wording and what a
// pick does differ — so both go through here.
//
// It lives outside block-modal.tsx because the modal pulls it through
// next/dynamic: cmdk is a few kB that no one reading a block ever needs, and
// both buttons are a click away from the picker appearing. Fully controlled
// (the modal owns `open`) so the button that opens it can stay in the page
// bundle while this doesn't.
export default function BlockChannelPicker({
  open,
  onOpenChange,
  title,
  description,
  channels,
  busy,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  channels: PickableChannel[];
  // A move/copy already in flight; picking again would fire a second one.
  busy: boolean;
  onPick: (channelId: number) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <CommandInput placeholder="Search channels…" />
      <CommandList>
        <CommandEmpty>No channels found.</CommandEmpty>
        {channels.map((c) => (
          <CommandItem
            key={c.id}
            value={`channel-${c.id}`}
            keywords={[c.title]}
            disabled={busy}
            onSelect={() => onPick(c.id)}
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
  );
}
