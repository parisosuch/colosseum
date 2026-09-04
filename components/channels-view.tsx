"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpDown, LayersIcon, ListFilter, RotateCw, SearchIcon } from "lucide-react";

import { loadChannelCards } from "@/app/[handle]/actions";
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
  CHANNELS_PAGE,
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

// A card whose previews haven't arrived yet. Same footprint as the real one so
// growing the window doesn't shift what's already on screen.
function CardPlaceholder() {
  return (
    <div className="aspect-square animate-pulse rounded-lg border-2 bg-muted/40 md:aspect-auto md:h-[334px]" />
  );
}

// The profile's channel listing with a search box and grid/list toggle,
// mirroring the channel board's block search and view switcher.
//
// `channels` is every channel on the profile, but only as metadata — that's
// what search, the filters and the sorts read, so all three stay complete and
// instant over the whole collection. The expensive part is the grid card, with
// its five server-rendered block previews: `gridCards` holds the first page and
// the rest are fetched a page at a time as the reader scrolls. View choice and
// query are ephemeral, like the board's.
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

  // No debounce: the metadata is already in memory, so filtering/sorting on
  // every keystroke or toggle is cheap and keeps it feeling instant.
  const visibleChannels = useMemo(
    () => filterSortChannels(channels, { search, access, memberOf }, sort),
    [channels, search, access, memberOf, sort],
  );

  // Server-rendered cards by channel id, seeded with the first page.
  const [cards, setCards] = useState(() => new Map(gridCards.map((c) => [c.id, c.node])));
  // Ids already asked for, so a card is fetched once even as the reader
  // filters back and forth over it. Failed ids come back out, for the retry.
  const requested = useRef(new Set(gridCards.map((c) => c.id)));
  const [loadingCards, setLoadingCards] = useState(false);
  const [cardsFailed, setCardsFailed] = useState(false);
  const [retries, setRetries] = useState(0);

  // How far down the filtered list we've rendered. Filtering re-orders the
  // list under the window, so it goes back to one page whenever it changes.
  const [windowSize, setWindowSize] = useState(CHANNELS_PAGE);
  useEffect(() => {
    setWindowSize(CHANNELS_PAGE);
  }, [search, access, memberOf, sort]);

  const shown = visibleChannels.slice(0, windowSize);
  const hasMore = visibleChannels.length > shown.length;
  const shownIds = shown.map((c) => c.id).join(",");

  // Fetch the cards for whatever is in the window and doesn't have one. Only in
  // grid view — the list rows render from metadata alone.
  useEffect(() => {
    if (view !== "grid" || !shownIds) return;
    const ids = shownIds
      .split(",")
      .map(Number)
      .filter((id) => !requested.current.has(id))
      .slice(0, CHANNELS_PAGE);
    if (ids.length === 0) return;

    for (const id of ids) requested.current.add(id);
    let cancelled = false;
    setLoadingCards(true);
    setCardsFailed(false);
    loadChannelCards(handle, ids)
      .then((loaded) => {
        if (cancelled) return;
        setCards((prev) => {
          const next = new Map(prev);
          for (const card of loaded) next.set(card.id, card.node);
          return next;
        });
      })
      .catch((e) => {
        console.error(e);
        if (cancelled) return;
        // Let a retry ask for them again.
        for (const id of ids) requested.current.delete(id);
        setCardsFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingCards(false);
      });
    return () => {
      cancelled = true;
    };
    // `cards` is in here so that when a window grows by more than one page at a
    // time — a fast scroll, or a filter that drops the reader deep into the
    // list — the ids the CHANNELS_PAGE cap left behind are picked up as soon as
    // the batch before them lands.
  }, [shownIds, view, handle, retries, cards]);

  // Grow the window as a sentinel below the grid nears the viewport, the way
  // the channel board and the Explore feed page. A ref keeps the observer
  // callback pointed at the current hasMore without re-creating the observer.
  const growRef = useRef<() => void>(() => {});
  growRef.current = () => {
    if (hasMore && !cardsFailed) setWindowSize((n) => n + CHANNELS_PAGE);
  };
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) growRef.current();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
              {/* Below sm the label is hidden, so the button is icon-only and
                  needs its own name; coarse:min-w-11 keeps the square wide
                  enough to hit on a touch screen (Button supplies the height). */}
              <Button
                variant="outline"
                className="gap-1.5 px-3 coarse:min-w-11"
                aria-label={`Sort by: ${SORT_LABELS[sort]}`}
              >
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
              <Button
                variant="outline"
                className="gap-1.5 px-3 coarse:min-w-11"
                aria-label={
                  activeFilters > 0 ? `Filter (${activeFilters} active)` : "Filter channels"
                }
              >
                <ListFilter className="size-4" />
                <span className="hidden sm:inline">Filter</span>
                {activeFilters > 0 ? (
                  <span
                    aria-hidden
                    className="grid size-4 place-items-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground"
                  >
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
          {shown.map((channel) => (
            <div key={channel.id}>{cards.get(channel.id) ?? <CardPlaceholder />}</div>
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
          {shown.map((channel) => (
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

      {/* Sentinel: grows the window as it nears the viewport. The button beside
          it is the same move without scrolling, for keyboards and for anyone
          the observer misses. */}
      <div ref={sentinelRef} className="h-1 w-full" />
      {cardsFailed ? (
        <div className="flex flex-col items-center gap-2 py-2 text-center" aria-live="polite">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load more channels.</p>
          <Button variant="outline" onClick={() => setRetries((n) => n + 1)}>
            <RotateCw />
            Try again
          </Button>
        </div>
      ) : hasMore ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <Button
            variant="outline"
            disabled={loadingCards}
            onClick={() => setWindowSize((n) => n + CHANNELS_PAGE)}
          >
            {loadingCards ? "Loading..." : "Load more channels"}
          </Button>
          <p className="text-caption">
            {shown.length} of {visibleChannels.length}
          </p>
        </div>
      ) : null}
    </div>
  );
}
