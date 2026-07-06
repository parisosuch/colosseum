"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { LayersIcon, LayoutGrid, List, SearchIcon } from "lucide-react";

import { LIST_GRID } from "./column";
import { timeAgo } from "@/lib/utils";
import CreateChannelButton from "./create-channel-button";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { channelMatches, type ChannelRow } from "./channel-filter";

export type { ChannelRow };

// The profile's channel listing with a search box and grid/list toggle,
// mirroring the channel board's block search and view switcher. Each grid card
// (with its server-fetched previews) is passed in via `gridCards` keyed by id;
// the list is built here from channel metadata and reuses the board's LIST_GRID
// table style. Search filters both views client-side over the already-loaded
// list. View choice and query are ephemeral, like the board's.
export function ChannelsView({
  isOwner,
  handle,
  gridCards,
  channels,
}: {
  isOwner: boolean;
  handle: string;
  gridCards: { id: number; node: ReactNode }[];
  channels: ChannelRow[];
}) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");

  // No debounce: the list is already in memory, so filtering on every keystroke
  // is cheap and keeps the search feeling instant.
  const visibleIds = useMemo(
    () => new Set(channels.filter((c) => channelMatches(c, search)).map((c) => c.id)),
    [channels, search],
  );
  const visibleChannels = channels.filter((c) => visibleIds.has(c.id));
  const visibleCards = gridCards.filter((c) => visibleIds.has(c.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {isOwner ? <CreateChannelButton /> : null}
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels"
            aria-label="Search channels"
            className="pl-8"
          />
        </div>
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

      {visibleChannels.length === 0 ? (
        <p className="text-muted-foreground">No channels match your search.</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 md:flex md:flex-col md:space-y-4 md:gap-0">
          {visibleCards.map((card) => (
            <div key={card.id}>{card.node}</div>
          ))}
        </div>
      ) : (
        <div>
          <div className={`border-b px-2 py-2 text-label ${LIST_GRID}`}>
            <span>Channel</span>
            <span>Description</span>
            <span className="hidden sm:block">Blocks</span>
            <span className="hidden sm:block">Created</span>
          </div>
          {visibleChannels.map((channel) => (
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
