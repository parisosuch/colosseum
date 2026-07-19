"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpDown, LayersIcon, ListFilter, SearchIcon } from "lucide-react";

import { LIST_GRID } from "./column";
import { timeAgo } from "@/lib/utils";
import CreateChannelButton from "./create-channel-button";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ViewToggle } from "./view-toggle";
import {
  filterSortChannels,
  type ChannelAccess,
  type ChannelRow,
  type ChannelSort,
} from "./channel-filter";

export type { ChannelRow };

const SORT_LABELS: Record<ChannelSort, string> = {
  recent: "Recently added to",
  name: "Name",
  count: "Column count",
};

const ACCESS_MODES: ChannelAccess[] = ["public", "open", "private"];

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
  const [sort, setSort] = useState<ChannelSort>("recent");
  const [access, setAccess] = useState<ChannelAccess[]>([]);
  const [memberOf, setMemberOf] = useState(false);

  const toggleAccess = (mode: ChannelAccess) =>
    setAccess((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));

  // The number of active filters, shown as a badge on the Filter button.
  const activeFilters = access.length + (memberOf ? 1 : 0);

  // No debounce: the list is already in memory, so filtering/sorting on every
  // keystroke or toggle is cheap and keeps it feeling instant.
  const visibleChannels = useMemo(
    () => filterSortChannels(channels, { search, access, memberOf }, sort),
    [channels, search, access, memberOf, sort],
  );
  // Reorder the server-fetched grid cards to match the filtered/sorted list.
  const cardById = useMemo(() => new Map(gridCards.map((c) => [c.id, c.node])), [gridCards]);
  const visibleCards = visibleChannels.map((c) => ({ id: c.id, node: cardById.get(c.id) }));

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <ArrowUpDown className="size-4" />
                <span className="hidden sm:inline">{SORT_LABELS[sort]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as ChannelSort)}>
                {(Object.keys(SORT_LABELS) as ChannelSort[]).map((key) => (
                  <DropdownMenuRadioItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <ListFilter className="size-4" />
                <span className="hidden sm:inline">Filter</span>
                {activeFilters > 0 ? (
                  <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                    {activeFilters}
                  </span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Access</DropdownMenuLabel>
              {ACCESS_MODES.map((mode) => (
                <DropdownMenuCheckboxItem
                  key={mode}
                  checked={access.includes(mode)}
                  // Keep the menu open so several filters can be toggled at once.
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleAccess(mode)}
                  className="capitalize"
                >
                  {mode}
                </DropdownMenuCheckboxItem>
              ))}
              {isOwner ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={memberOf}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(v) => setMemberOf(v === true)}
                  >
                    Member of
                  </DropdownMenuCheckboxItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {visibleChannels.length === 0 ? (
        <p className="text-muted-foreground">No channels match your filters.</p>
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
            <span className="hidden sm:block">Columns</span>
            <span className="hidden sm:block">Created</span>
          </div>
          {visibleChannels.map((channel) => (
            <Link
              key={channel.id}
              href={`/${channel.handle ?? handle}/${channel.id}`}
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
                {channel.memberOf ? (
                  <span className="shrink-0 text-xs text-muted-foreground">member of</span>
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
