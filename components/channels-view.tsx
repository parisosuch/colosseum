"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { LayersIcon, LayoutGrid, List } from "lucide-react";

import { LIST_GRID } from "./column";
import { timeAgo } from "@/lib/utils";
import CreateChannelButton from "./create-channel-button";
import { Button } from "./ui/button";

export type ChannelRow = {
  id: number;
  title: string;
  description?: string;
  private: boolean;
  created_at: string;
  count: number;
};

// The profile's channel listing with a grid/list toggle, mirroring the channel
// board's block view switcher. The grid (with server-fetched previews) is passed
// in as `grid`; the list is built here from channel metadata and reuses the
// board's LIST_GRID table style. View choice is ephemeral, like the board's.
export function ChannelsView({
  isOwner,
  handle,
  grid,
  channels,
}: {
  isOwner: boolean;
  handle: string;
  grid: ReactNode;
  channels: ChannelRow[];
}) {
  const [view, setView] = useState<"grid" | "list">("grid");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {isOwner ? <CreateChannelButton /> : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon"
            aria-label="Grid view"
            onClick={() => setView("grid")}
          >
            <LayoutGrid />
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="icon"
            aria-label="List view"
            onClick={() => setView("list")}
          >
            <List />
          </Button>
        </div>
      </div>

      {view === "grid" ? (
        grid
      ) : (
        <div>
          <div className={`border-b px-2 py-2 text-label ${LIST_GRID}`}>
            <span>Channel</span>
            <span>Description</span>
            <span className="hidden sm:block">Blocks</span>
            <span className="hidden sm:block">Created</span>
          </div>
          {channels.map((channel) => (
            <Link
              key={channel.id}
              href={`/${handle}/${channel.id}`}
              className={`w-full border-b px-2 py-2 text-left hover:bg-muted/50 ${LIST_GRID}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="grid size-10 shrink-0 place-items-center rounded-md border text-muted-foreground">
                  <LayersIcon className="size-4" />
                </div>
                <span className="truncate text-sm">{channel.title}</span>
                {channel.private ? (
                  <span className="shrink-0 text-xs text-muted-foreground">private</span>
                ) : null}
              </div>
              <span className="truncate text-sm text-muted-foreground">
                {channel.description || ""}
              </span>
              <span className="hidden truncate text-sm sm:block">{channel.count}</span>
              <span className="hidden truncate text-caption sm:block">
                {timeAgo(new Date(channel.created_at))}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
