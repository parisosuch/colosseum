"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { BlockMedia } from "@/components/column";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getCanvasBlocksAction, getUnplacedBlocksAction } from "@/lib/colosseum/canvas-actions";
import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { CARD_MEDIA_RADIUS } from "@/lib/utils";
import type { CanvasStore } from "./canvas-store";
import { BLOCK_DRAG_TYPE } from "./canvas-viewport";
import { useCanvas } from "./use-canvas";

const PAGE = 40;
// One row of two 124px cards: the square, a 6px gap, a 16px title, and the
// 12px gap to the next row.
const ROW_HEIGHT = 124 + 6 + 16 + 12;
const OVERSCAN_ROWS = 3;

function blockTitle(c: Column, screenshot?: ColumnScreenshot): string {
  return c.title || screenshot?.title || c.url || c.text?.slice(0, 80) || "Untitled block";
}

// The left panel's Blocks tab: every block in the channel that isn't on the
// canvas, newest first, drawn as its card. Drag one onto the board to place it,
// or focus it and press Enter to drop it in the middle of the view.
//
// Paged by cursor and virtualized, so a channel of thousands of blocks keeps a
// screenful of cards in the DOM. Placing and removing blocks updates the list
// at once, and blocks added or deleted elsewhere arrive over the canvas socket.
export function BlocksPanel({
  store,
  channelId,
  knownColumns,
  screenshots,
  onLoaded,
  onPlace,
  start,
}: {
  store: CanvasStore;
  channelId: number;
  // Blocks the canvas has already loaded, so one taken off the board can come
  // back into the list without a fetch.
  knownColumns: ReadonlyMap<number, Column | null>;
  screenshots: ReadonlyMap<string, ColumnScreenshot>;
  // Every block this panel fetches, so the page can share them with the board
  // and resolve their screenshots.
  onLoaded: (columns: Column[]) => void;
  onPlace: (column: Column) => void;
  // Hold the first page until the board has what it needs. Next runs server
  // actions one at a time, so the list would otherwise queue ahead of the
  // placed blocks the open transition is waiting on.
  start: boolean;
}) {
  const doc = useCanvas(store, "doc", (s) => s.docState);
  const synced = useCanvas(store, "connection", (s) => s.connection.synced);
  const placed = doc.placed;

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Column[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  // How many matched when the first page was fetched, and which blocks were
  // on the canvas at that moment; the line under the search adjusts from there
  // as blocks are placed and removed.
  const [base, setBase] = useState<{ count: number; placed: ReadonlySet<number> } | null>(null);
  const seen = useRef(new Set<number>());
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const placedRef = useRef(placed);
  useLayoutEffect(() => {
    placedRef.current = placed;
  });

  const loadPage = async (reset: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const before = reset ? null : (items.at(-1)?.id ?? null);
      const placedNow = placedRef.current;
      const res = await getUnplacedBlocksAction(channelId, {
        placed: [...placedNow],
        search: query,
        before,
        limit: PAGE,
      });
      if (id !== requestId.current) return;
      for (const c of res.columns) seen.current.add(c.id);
      onLoaded(res.columns);
      setItems((prev) => (reset ? res.columns : [...prev, ...res.columns]));
      setHasMore(res.columns.length === PAGE);
      if (res.count !== null) setBase({ count: res.count, placed: new Set(placedNow) });
      setInitialized(true);
    } catch (e) {
      console.error(e);
      if (id === requestId.current) toast.error("Couldn't load the channel's blocks.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  // First page once the doc has synced (the placed set is only known then),
  // and again whenever the search changes.
  useEffect(() => {
    if (!synced || !start) return;
    seen.current = new Set();
    void loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPage reads the latest state through refs.
  }, [synced, start, query, channelId]);

  // A block taken off the canvas comes back into the list, at its place in
  // the order, if it falls inside what's loaded so far.
  const prevPlaced = useRef(placed);
  useEffect(() => {
    const before = prevPlaced.current;
    prevPlaced.current = placed;
    const returned: Column[] = [];
    for (const id of before) {
      if (placed.has(id)) continue;
      const col = knownColumns.get(id);
      if (!col) continue;
      if (query && !seen.current.has(id)) continue;
      returned.push(col);
    }
    if (returned.length === 0) return;
    setItems((prev) => {
      const have = new Set(prev.map((c) => c.id));
      const last = prev.at(-1)?.id ?? Infinity;
      const add = returned.filter((c) => !have.has(c.id) && (!hasMore || c.id > last));
      if (add.length === 0) return prev;
      for (const c of add) seen.current.add(c.id);
      return [...prev, ...add].sort((a, b) => b.id - a.id);
    });
  }, [placed, knownColumns, query, hasMore]);

  // Blocks added or deleted outside the canvas: grid view, the API, MCP.
  useEffect(
    () =>
      store.onChannelEvent((event) => {
        if (event.type === "block.removed") {
          setItems((prev) => prev.filter((c) => c.id !== event.columnId));
          if (seen.current.has(event.columnId) && !placedRef.current.has(event.columnId)) {
            setBase((b) => (b ? { ...b, count: Math.max(0, b.count - 1) } : b));
          }
          seen.current.delete(event.columnId);
        } else if (event.type === "block.added") {
          void getCanvasBlocksAction(channelId, [event.columnId])
            .then(([col]) => {
              if (!col) return;
              onLoaded([col]);
              // A search result list only takes what the server matched.
              if (query) return;
              seen.current.add(col.id);
              setItems((prev) =>
                prev.some((c) => c.id === col.id)
                  ? prev
                  : [...prev, col].sort((a, b) => b.id - a.id),
              );
              setBase((b) => (b ? { ...b, count: b.count + 1 } : b));
            })
            .catch((e) => console.error(e));
        }
      }),
    [store, channelId, query, onLoaded],
  );

  const visible = items.filter((c) => !placed.has(c.id));

  let count: number | null = null;
  if (base) {
    let n = base.count;
    for (const id of placed) if (!base.placed.has(id) && (!query || seen.current.has(id))) n--;
    for (const id of base.placed) if (!placed.has(id) && (!query || seen.current.has(id))) n++;
    count = Math.max(n, visible.length);
  }

  // --- virtualization ---
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const rows = Math.ceil(visible.length / 2);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN_ROWS);

  // Near the end of what's loaded: fetch the next page.
  useEffect(() => {
    if (!initialized || loading || !hasMore) return;
    if (lastRow >= rows - OVERSCAN_ROWS) void loadPage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPage reads the latest state through refs.
  }, [initialized, loading, hasMore, lastRow, rows]);

  const label =
    count === null
      ? " "
      : query
        ? `${count} ${count === 1 ? "match" : "matches"}`
        : `${count} not on the canvas`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search blocks"
          aria-label="Search blocks not on the canvas"
          className="pl-8"
        />
      </div>
      <p className="text-caption tabular-nums" aria-live="polite">
        {label}
      </p>
      <div
        ref={scrollRef}
        className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {!initialized ? (
          <div className="grid grid-cols-2 gap-x-2 gap-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="pt-6 text-center text-sm text-muted-foreground">
            {query ? "No blocks off the canvas match." : "Every block is on the canvas."}
          </p>
        ) : (
          <div className="relative" style={{ height: rows * ROW_HEIGHT - 12 }}>
            {visible.slice(firstRow * 2, lastRow * 2).map((c, i) => {
              const index = firstRow * 2 + i;
              const shot = c.url ? screenshots.get(c.url) : undefined;
              const title = blockTitle(c, shot);
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  aria-label={`Place ${title} on the canvas`}
                  title={title}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(BLOCK_DRAG_TYPE, String(c.id));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPlace(c);
                    }
                  }}
                  className="focus-ring absolute w-[calc(50%-4px)] cursor-grab rounded-lg active:cursor-grabbing"
                  style={{
                    top: Math.floor(index / 2) * ROW_HEIGHT,
                    left: index % 2 === 0 ? 0 : "calc(50% + 4px)",
                  }}
                >
                  <div
                    className={`pointer-events-none aspect-square w-full overflow-hidden border bg-card ${CARD_MEDIA_RADIUS}`}
                  >
                    <BlockMedia column={c} screenshot={shot} compact />
                  </div>
                  <p className="truncate pt-1.5 text-xs font-medium">{title}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
