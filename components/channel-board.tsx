"use client";

import PageHeader from "@/components/page-header";
import ColumnComponent, { LIST_GRID, REORDER_HELP_ID } from "@/components/column";
import { useBlockReorder } from "@/components/use-block-reorder";
import BlockModal from "@/components/block-modal";
import { useNeighbourPrefetch } from "@/components/block-prefetch";
import ConnectChannelButton from "@/components/connect-channel-button";
import type { PickableChannel } from "@/components/add-block-drawer";
import ManageChannelButton from "@/components/manage-channel-button";
import { LeaveChannelButton } from "@/components/leave-channel-button";
import ChannelMembersBar from "@/components/channel-members-bar";
import ExportChannelButton from "@/components/export-channel-button";
import AdminDeleteButton from "@/components/admin-delete-button";
import { ViewToggle } from "@/components/view-toggle";
import { PAGE_SIZE, SKELETON_COUNT } from "@/lib/pagination";
import { SCREENSHOT_MAX_ATTEMPTS, nextScreenshotPoll, whenVisible } from "@/lib/screenshot-poll";
import ColumnInput, { ColumnUploadProgress, useColumnUpload } from "@/components/column-input";
import ChannelControls from "@/components/channel-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { GradientSpin } from "@/components/gradient-spin";
import type { Channel } from "@/lib/colosseum/channel";
import type { ChannelMember } from "@/lib/colosseum/member";
import type { Column, ColumnFilter, ColumnSort } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import {
  adminDeleteChannelAction,
  getChannelColumnCountAction,
  getChannelColumnsAction,
  getColumnNeighboursAction,
  getScreenshotsForUrlsAction,
  reorderColumnAction,
} from "@/lib/colosseum/actions";
import { Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

// How many cards load their thumbnail eagerly; the rest are lazy and wait until
// they're scrolled near. The grid tops out at six columns (2xl), so six covers
// the widest first row — the row LCP is usually measured against — and costs at
// most a few extra requests on a narrow screen. List rows are 40px thumbnails,
// so many more of them fit above the fold before scrolling starts.
const EAGER_GRID_THUMBS = 6;
const EAGER_LIST_THUMBS = 16;

// One placeholder tile, sized to match a real block in the current view (square
// card in grid, compact row in list). Keeps the layout from reflowing when
// blocks swap in.
function BlockSkeleton({ view }: { view: "grid" | "list" }) {
  if (view === "list") {
    return (
      <div className={`border-b px-2 py-2 ${LIST_GRID}`}>
        <div className="flex items-center gap-2">
          <Skeleton className="size-10 shrink-0" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="hidden h-4 w-2/3 sm:block" />
        <Skeleton className="hidden h-3 w-1/2 sm:block" />
      </div>
    );
  }
  return (
    <div className="w-full">
      {/* rounded-lg rather than the Skeleton default, so the placeholder tile
          has the same corner as the real card it stands in for. */}
      <Skeleton className="w-full aspect-square border rounded-lg" />
      {/* Two caption lines, matching a real card's title + timestamp. The
          wrappers are divs, not <p>: Skeleton renders a div, which a paragraph
          may not contain, and all these carry is the caption line-height. */}
      <div className="pt-1 text-xs">
        <Skeleton className="inline-block h-3 w-2/3 align-middle" />
      </div>
      <div className="text-xs">
        <Skeleton className="inline-block h-3 w-1/3 align-middle" />
      </div>
    </div>
  );
}

// Nothing to show. Distinguishes an empty channel from a filter that matched
// nothing — the second is a control the viewer can undo, and in list view both
// used to render as a bare table header over no rows.
function EmptyBlocks({ filtered }: { filtered: boolean }) {
  return (
    <p className="py-8 text-center text-muted-foreground">
      {filtered ? "No blocks match this search or filter." : "No blocks yet."}
    </p>
  );
}

// The slice of the session user the board (and ColumnInput) actually needs —
// the channel page passes the Better Auth session user, which satisfies this.
export type SessionUser = { id: string };

type ChannelBoardProps = {
  channel: Channel;
  handle: string;
  isOwner: boolean;
  // Whether the viewer is an invited member (never the owner). Shows the
  // self-service Leave button.
  isMember: boolean;
  // Whether the viewer is an instance admin. Unlocks moderation (deleting other
  // people's public/open channels and blocks); never applies to private channels.
  isAdmin: boolean;
  // Whether the viewer may add blocks: owner (public), anyone signed in (open),
  // or owner/member (private). Gates every add-block affordance below.
  canContribute: boolean;
  user: SessionUser | null;
  initialCount: number;
  newestAt: string | null;
  // Created-on formatted on the server, so the absolute date can't shift with
  // the client timezone and cause a hydration mismatch.
  createdOnLabel: string;
  // The viewer's own channels, for the block modal's "Move" picker (owner only)
  // and the "Connect to channel" button (any viewer). Empty when signed out.
  channels: PickableChannel[];
  // The channel's invited members (empty for open/solo channels), and the owner's
  // avatar, for the collaborators bar. Held as state so the settings editor's
  // add/remove updates the bar live.
  members: ChannelMember[];
  ownerAvatarUrl: string | null;
  // The first page of blocks, server-rendered so the grid paints without a
  // hydrate + server-action round-trip. Seeds `columns`; the mount fetch is
  // skipped while the controls are still at their defaults.
  initialColumns: Column[];
  // Cached screenshots for the first page's URL blocks (entries, not a Map — a
  // Map isn't needed on the wire), so previews paint without a second fetch.
  initialScreenshots: [string, ColumnScreenshot][];
  // The `?block=` deep-linked block, already visibility-checked by the page, so
  // a shared link paints with its modal open. Resolved server-side because the
  // block can be older than `initialColumns`, which stops at one page.
  initialBlock: Column | null;
  initialBlockScreenshot: ColumnScreenshot | null;
};

export default function ChannelBoard({
  channel: initialChannel,
  handle,
  isOwner,
  isMember,
  isAdmin,
  canContribute,
  user,
  initialCount,
  newestAt: initialNewestAt,
  createdOnLabel,
  channels,
  members: initialMembers,
  ownerAvatarUrl,
  initialColumns,
  initialScreenshots,
  initialBlock,
  initialBlockScreenshot,
}: ChannelBoardProps) {
  const router = useRouter();
  const [members, setMembers] = useState<ChannelMember[]>(initialMembers);
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [columns, setColumns] = useState<Column[]>(initialColumns);
  const [screenshots, setScreenshots] = useState<Map<string, ColumnScreenshot>>(() => {
    const map = new Map(initialScreenshots);
    // The deep-linked block can be past the first page, so its preview isn't in
    // initialScreenshots — seed it or the opened modal shows an empty frame.
    if (initialBlock?.url && initialBlockScreenshot) {
      map.set(initialBlock.url, initialBlockScreenshot);
    }
    return map;
  });

  // Channel-wide stats, kept independent of the paged/filtered `columns` list so
  // the meta panel always reflects the whole channel.
  const [totalCount, setTotalCount] = useState(initialCount);
  const [newestAt, setNewestAt] = useState<string | null>(initialNewestAt);

  // Search / filter / sort controls. `debouncedSearch` is what actually drives
  // the query, so typing doesn't fire a request per keystroke.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ColumnFilter>("all");
  // Matches the sort the page server-rendered `initialColumns` with, or the
  // mount effect would immediately refetch the page already on screen.
  const [sort, setSort] = useState<ColumnSort>("manual");

  // Paging state for the current control selection. Seeded from the
  // server-rendered first page, so nothing loads on mount.
  const [loadingPage, setLoadingPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialColumns.length === PAGE_SIZE);
  // How many blocks the current search/filter matches, channel-wide. Null while
  // nothing is filtered (the answer is then the channel's own length) and while
  // the count for a new selection is still in flight.
  const [filteredCount, setFilteredCount] = useState<number | null>(null);

  // Grid (square cards) vs list (Are.na-style table) layout for the block area.
  const [view, setView] = useState<"grid" | "list">("grid");
  // In table view the block input is collapsed behind an "Add block" button.
  const [adding, setAdding] = useState(false);

  // Which block's modal is open, so it can step to a sibling block in place.
  // Seeded from the `?block=` deep link so a shared URL opens straight into it.
  const [openId, setOpenId] = useState<number | null>(initialBlock?.id ?? null);
  const openBlock = useCallback((id: number) => setOpenId(id), []);

  // A block being read that the board hasn't loaded: the `?block=` deep link
  // when it points past the first page, and whatever the arrows step to from
  // there. Its neighbours can't come from `columns` — it isn't in it — so they
  // are resolved against the whole channel below.
  const [detached, setDetached] = useState<Column | null>(initialBlock);
  const [detachedSiblings, setDetachedSiblings] = useState<{
    prev: Column | null;
    next: Column | null;
  }>({ prev: null, next: null });

  const openIndex = openId == null ? -1 : columns.findIndex((c) => c.id === openId);
  // The detached block is only authoritative while it really is absent from
  // `columns`: step back into the loaded prefix and ordinary index navigation
  // takes over again.
  const detachedColumn =
    openIndex < 0 && openId != null && detached?.id === openId ? detached : null;

  // URLs whose screenshot is being captured in the background. The hydrate
  // effect skips these so the row keeps showing a spinner (instead of resolving
  // to an empty preview) until the capture lands.
  const [capturing, setCapturing] = useState<Set<string>>(new Set());

  // Blocks can also arrive with no screenshot yet from outside this session —
  // the REST API captures previews asynchronously, so a freshly created (or
  // just-migrated) url block may take a few seconds to a couple minutes before
  // one lands. Retry count per URL, so the hydrate effect below keeps polling
  // instead of caching "no preview" on the very first miss. Not component
  // state: a bump doesn't need its own render.
  const screenshotRetries = useRef(new Map<string, number>());
  // ponytail: polled with backoff + an attempt cap (no websocket/SSE); bump
  // this to re-run the hydrate effect, either off a timer or when a hidden tab
  // comes back.
  const [pollTick, setPollTick] = useState(0);

  // Which blocks need a screenshot resolved. The loaded ones, plus a detached
  // block being read: it isn't in `columns`, so without this a link block
  // arrived at by arrowing past the loaded page shows an empty preview frame.
  const screenshotTargets = useMemo(
    () => (detachedColumn ? [...columns, detachedColumn] : columns),
    [columns, detachedColumn],
  );

  const metaData = useMemo(() => {
    let lastModified = "-";
    if (newestAt) {
      const diffInDays = Math.floor((Date.now() - new Date(newestAt).getTime()) / 86400000);
      lastModified = diffInDays === 0 ? "Today" : `${diffInDays} days ago`;
    }

    return [
      { title: "Created On", data: createdOnLabel },
      { title: "Last Modified", data: lastModified },
      { title: "Length", data: totalCount.toString() },
    ];
  }, [createdOnLabel, newestAt, totalCount]);

  // Debounce the search box so each keystroke doesn't fire a query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Skip the first run of the effect below: it fires on mount with the controls
  // at their defaults, which is exactly the page the server already rendered
  // into `columns`. Any later control change still refetches.
  const skipInitialFetch = useRef(true);

  // Whether the board is showing a subset of the channel. Sort doesn't narrow
  // anything, so it isn't part of this.
  const isFiltered = debouncedSearch.trim() !== "" || typeFilter !== "all";

  // Load (or reload) the first page whenever the channel or any control changes.
  // The previous list stays on screen until the new one resolves — the grid dims
  // rather than emptying — so changing a control doesn't flash a blank board.
  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }

    let cancelled = false;
    setLoadingPage(true);
    setFilteredCount(null);
    (async () => {
      try {
        // The count is what the controls report; it's a separate query because
        // the page is capped at PAGE_SIZE and can't answer "how many matched".
        const [first, matched] = await Promise.all([
          getChannelColumnsAction(channel.id, {
            search: debouncedSearch,
            type: typeFilter,
            sort,
            limit: PAGE_SIZE,
            offset: 0,
          }),
          isFiltered
            ? getChannelColumnCountAction(channel.id, { search: debouncedSearch, type: typeFilter })
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setColumns(first);
        setHasMore(first.length === PAGE_SIZE);
        setFilteredCount(matched);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast.error("Failed to load columns.");
      } finally {
        if (!cancelled) setLoadingPage(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channel.id, debouncedSearch, typeFilter, sort, isFiltered]);

  // Append the next page. Offset is the count already loaded.
  const loadMore = useCallback(async () => {
    if (loadingMore || loadingPage || !hasMore) return;

    setLoadingMore(true);
    try {
      const next = await getChannelColumnsAction(channel.id, {
        search: debouncedSearch,
        type: typeFilter,
        sort,
        limit: PAGE_SIZE,
        offset: columns.length,
      });
      setColumns((prev) => [...prev, ...next]);
      setHasMore(next.length === PAGE_SIZE);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMore(false);
    }
  }, [
    channel.id,
    loadingMore,
    loadingPage,
    hasMore,
    debouncedSearch,
    typeFilter,
    sort,
    columns.length,
  ]);

  // Observe a sentinel below the grid; load the next page as it nears the
  // viewport. A ref keeps the observer callback pointed at the latest loadMore
  // without re-creating the observer on every render.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Hydrate screenshots for the loaded URL columns in one batched (chunked)
  // query instead of each ColumnComponent fetching its own. Runs as pages
  // append; only URLs not already resolved are fetched.
  useEffect(() => {
    const missing = screenshotTargets
      .filter((c) => c.type === "url" && c.url && !screenshots.has(c.url) && !capturing.has(c.url))
      .map((c) => c.url!);

    if (missing.length === 0) {
      return;
    }

    // A tab nobody is looking at shouldn't spend server actions on previews it
    // isn't painting. Sit the round out and pick it back up on the way in.
    if (document.hidden) {
      return whenVisible(document, () => setPollTick((t) => t + 1));
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopWaiting: (() => void) | null = null;

    (async () => {
      try {
        const fetched = new Map(await getScreenshotsForUrlsAction(missing));
        if (cancelled) return;

        // Collect into a plain Map first and only call setScreenshots if
        // something actually resolved. `screenshots` is a dependency of this
        // same effect — writing a new Map reference on every round (even one
        // where every URL is still pending) would retrigger this effect
        // immediately, cascading into itself and orphaning whatever the round
        // scheduled below (each instance gets cancelled by the next before its
        // own timer fires). Skipping the write when nothing changed is what
        // keeps the backoff real instead of racing itself.
        let pendingAttempts: number | null = null;
        const updates = new Map<string, ColumnScreenshot>();
        for (const url of missing) {
          const row = fetched.get(url);
          if (row?.image_url) {
            updates.set(url, row);
            screenshotRetries.current.delete(url);
            continue;
          }
          if (fetched.has(url)) {
            // A row exists but has no image — capture ran and failed
            // permanently. Settle now; no point polling further.
            updates.set(url, row!);
            screenshotRetries.current.delete(url);
            continue;
          }
          // No row at all yet — it may still be capturing (this block could've
          // been created via the API, or by another session). Keep polling a
          // bounded number of times before settling on "no preview" for good.
          const attempts = (screenshotRetries.current.get(url) ?? 0) + 1;
          screenshotRetries.current.set(url, attempts);
          if (attempts >= SCREENSHOT_MAX_ATTEMPTS) {
            updates.set(url, { url, image_url: null, title: null, captured_at: null });
          } else {
            pendingAttempts = Math.min(pendingAttempts ?? attempts, attempts);
          }
        }

        if (updates.size > 0) {
          setScreenshots((prev) => {
            const next = new Map(prev);
            for (const [url, row] of updates) next.set(url, row);
            return next;
          });
        }

        const decision = nextScreenshotPoll(pendingAttempts, document.hidden);
        if (decision.kind === "schedule") {
          timer = setTimeout(() => {
            if (!cancelled) setPollTick((t) => t + 1);
          }, decision.delayMs);
        } else if (decision.kind === "await-visible") {
          // Went to the background mid-round. No point holding a timer that
          // would fire into a hidden tab and be turned away by the guard
          // above; wait for the tab to come back instead.
          stopWaiting = whenVisible(document, () => {
            if (!cancelled) setPollTick((t) => t + 1);
          });
        }
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      stopWaiting?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pollTick only retriggers the effect; it's not read inside.
  }, [screenshotTargets, screenshots, capturing, pollTick]);

  // A new block is the newest and bumps the channel length; reflect that in the
  // stats without refetching the whole channel.
  const handleBlockAdded = useCallback(() => {
    setTotalCount((c) => c + 1);
    setNewestAt(new Date().toISOString());
    // Close the table view's add-block modal.
    setAdding(false);
  }, []);

  // One upload path for the whole board: the input tile, the list view's
  // add-block dialog, and the board-wide drop target below all feed it, so a
  // file lands the same way wherever it was let go.
  const uploader = useColumnUpload({
    user,
    channel,
    setColumns,
    onBlockAdded: handleBlockAdded,
  });

  // Dragging files anywhere over the board. Counted, not a boolean: dragenter
  // and dragleave fire for every element the pointer crosses, so a plain flag
  // clears itself the moment the drag passes over a card.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  // Only file drags — dragging selected text across the page shouldn't put a
  // "drop to upload" sheet over the channel.
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  const boardDragProps = canContribute
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!isFileDrag(e)) return;
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (e: React.DragEvent) => {
          if (!isFileDrag(e)) return;
          // Without this the browser navigates away to the dropped file.
          e.preventDefault();
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!isFileDrag(e)) return;
          // No relatedTarget means the drag left the window rather than moving
          // onto another element, and there'll be no matching enter to balance.
          dragDepth.current = e.relatedTarget === null ? 0 : Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (e.dataTransfer.files?.length) void uploader.uploadFiles(e.dataTransfer.files);
        },
      }
    : {};

  const beginCapture = useCallback((url: string) => {
    setCapturing((prev) => new Set(prev).add(url));
    // A previous attempt for this URL may have already settled to "no
    // preview" (this block's own prior instance, or a sibling block sharing
    // the URL) — clear it and the exhausted retry count so this fresh
    // attempt starts from a real loading state instead of instantly
    // re-showing the stale failure.
    screenshotRetries.current.delete(url);
    setScreenshots((prev) => {
      if (!prev.has(url)) return prev;
      const next = new Map(prev);
      next.delete(url);
      return next;
    });
  }, []);

  // The screenshot landed: stop treating the URL as capturing and drop it from
  // the cache so the hydrate effect refetches the now-captured preview.
  const refreshScreenshot = useCallback((url: string) => {
    setCapturing((prev) => {
      const next = new Set(prev);
      next.delete(url);
      return next;
    });
    setScreenshots((prev) => {
      const next = new Map(prev);
      next.delete(url);
      return next;
    });
  }, []);

  const openColumn = openIndex >= 0 ? columns[openIndex] : detachedColumn;

  const hasPrev = detachedColumn ? detachedSiblings.prev != null : openIndex > 0;
  // Past the last loaded block there can still be more of the channel. The
  // arrow stays live and fetches the next page, instead of dead-ending at
  // whatever the last scroll happened to load.
  const hasNext = detachedColumn
    ? detachedSiblings.next != null
    : openIndex >= 0 && (openIndex < columns.length - 1 || hasMore);

  // Set when Next ran out of loaded blocks: the step is owed until the page it
  // asked for lands.
  const [pendingNext, setPendingNext] = useState(false);

  // Step the open modal to an adjacent block. Clamps at the ends of the channel
  // (not at the end of what's loaded, and not at a deep-linked block's own id).
  const navigate = useCallback(
    (dir: -1 | 1) => {
      if (detachedColumn) {
        const target = dir === 1 ? detachedSiblings.next : detachedSiblings.prev;
        if (!target) return;
        setDetached(target);
        setOpenId(target.id);
        return;
      }
      if (openIndex < 0) return;
      const target = columns[openIndex + dir];
      if (target) {
        setOpenId(target.id);
      } else if (dir === 1 && hasMore) {
        setPendingNext(true);
        void loadMore();
      }
    },
    [columns, openIndex, detachedColumn, detachedSiblings, hasMore, loadMore],
  );

  // The page Next asked for has landed (or the request went nowhere): take the
  // owed step, or drop it. The modal covers the infinite-scroll sentinel, so
  // this is the only thing that pages a channel while a block is open.
  useEffect(() => {
    if (!pendingNext || loadingMore) return;
    const i = openId == null ? -1 : columns.findIndex((c) => c.id === openId);
    const target = i >= 0 ? columns[i + 1] : undefined;
    if (target) setOpenId(target.id);
    setPendingNext(false);
  }, [pendingNext, loadingMore, columns, openId]);

  // Resolve a detached block's neighbours against the whole channel, in the
  // order the board is currently showing. Without this a shared `?block=` link
  // to anything past the first page opens with both arrows dead.
  useEffect(() => {
    const id = detachedColumn?.id;
    if (id == null) return;

    let cancelled = false;
    setDetachedSiblings({ prev: null, next: null });
    (async () => {
      try {
        const siblings = await getColumnNeighboursAction(channel.id, id, {
          search: debouncedSearch,
          type: typeFilter,
          sort,
        });
        if (!cancelled) setDetachedSiblings(siblings);
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detachedColumn?.id, channel.id, debouncedSearch, typeFilter, sort]);

  // Whether blocks can be dragged into a new order right now. Three conditions,
  // each answering a question the feature can't dodge:
  //
  //  - `isOwner`: a block's place is stored on its row, so one person's reorder
  //    rearranges the board for everyone. That is the channel's arrangement,
  //    not the viewer's, so it follows ownership rather than the contributor
  //    rule that governs adding blocks. The action enforces the same thing; this
  //    only decides whether to draw the handles.
  //  - `sort === "manual"`: every other sort is computed from the block itself,
  //    so a drag under "Title A–Z" would be undone by the next read.
  //  - `!isFiltered`: dragging card 3 above card 1 in a filtered grid is
  //    ambiguous, because the blocks the filter hid still sit between them and
  //    the drop can't say which side of those it means. The order shown is real
  //    either way — it just can't be edited through a partial view.
  const canReorder = isOwner && sort === "manual" && !isFiltered;

  // The element the cards are in, so the reorder hook can measure them. One ref
  // for both views; it reads `[data-column-id]`, so the grid's add-block tile
  // and the list's header row are simply not cards.
  const blockAreaRef = useRef<HTMLDivElement | null>(null);

  const blockLabel = useCallback((c: Column) => c.title || c.url || "Untitled block", []);
  const commitReorder = useCallback(async (id: number, afterId: number | null) => {
    await reorderColumnAction(id, afterId);
  }, []);

  const reorder = useBlockReorder<Column>({
    enabled: canReorder,
    containerRef: blockAreaRef,
    items: columns,
    setItems: setColumns,
    axis: view === "list" ? "vertical" : "horizontal",
    label: blockLabel,
    commit: commitReorder,
  });

  // Warm the blocks either side of the open one — their media and their comment
  // thread — so stepping with ← / → arrives on something already loaded. Inert
  // while the modal is closed (openIndex is -1).
  useNeighbourPrefetch(columns, openIndex, screenshots);

  // If the open block leaves the list (deleted, or filtered out by a control
  // change), close the modal instead of stranding it on a gone block. A
  // detached block is exempt — it legitimately isn't in `columns` when it sits
  // past the first page, and closing it would defeat the whole deep link.
  useEffect(() => {
    if (openId != null && openId !== detached?.id && !columns.some((c) => c.id === openId)) {
      setOpenId(null);
    }
  }, [columns, openId, detached?.id]);

  // Keep the URL in step with the modal, so a permalink can be copied from the
  // address bar and Back closes the modal rather than leaving the channel.
  // history.pushState (not router.push) because this is the same route either
  // way — a router navigation would re-run the server component and throw away
  // the loaded pages behind the modal.
  //
  // Opening pushes an entry so Back can pop it; stepping between blocks with
  // the arrows replaces, or a walk through a channel would bury the entry the
  // user actually arrived on. `skipUrlSync` covers the popstate-driven updates,
  // where the URL is already what it should be.
  const skipUrlSync = useRef(true);
  const lastOpenId = useRef<number | null>(openId);
  useEffect(() => {
    if (skipUrlSync.current) {
      skipUrlSync.current = false;
      lastOpenId.current = openId;
      return;
    }
    const base = `/${handle}/${channel.id}`;
    const url = openId == null ? base : `${base}?block=${openId}`;
    // Stepping between blocks: replace. Opening or closing: push.
    const stepping = openId != null && lastOpenId.current != null;
    lastOpenId.current = openId;
    if (stepping) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }, [openId, handle, channel.id]);

  // Back/forward: read the modal state back out of the URL. Same-route history
  // moves don't re-render the server component, so nothing else would notice.
  useEffect(() => {
    const onPopState = () => {
      const block = new URLSearchParams(window.location.search).get("block");
      const id = block ? parseInt(block, 10) : NaN;
      skipUrlSync.current = true;
      setOpenId(Number.isNaN(id) ? null : id);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <div className="relative w-full p-6 sm:p-12 space-y-8" {...boardDragProps}>
      {/* Drop anywhere. The input tile is one cell of the grid and isn't on the
          page at all in list view, so a drag from outside the browser used to
          have a 2.5%-of-the-board target and no feedback until it found it. */}
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-6">
          <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-10 py-8 text-center">
            <Upload className="size-8 text-muted-foreground" />
            <p className="text-lg font-medium">Drop to add blocks</p>
            <p className="text-caption">Images, videos, PDFs and Markdown files.</p>
          </div>
        </div>
      ) : null}
      <ColumnUploadProgress uploader={uploader} />
      <PageHeader crumbs={[{ label: handle, href: `/${handle}` }, { label: channel.title }]} />
      <div className="flex items-center gap-2">
        {isOwner ? (
          <ManageChannelButton
            channel={channel}
            handle={handle}
            onUpdated={setChannel}
            members={members}
            setMembers={setMembers}
          />
        ) : null}
        {isMember ? (
          <LeaveChannelButton
            channelId={channel.id}
            handle={handle}
            title={channel.title}
            isPrivate={channel.private}
          />
        ) : null}
        {/* Any signed-in viewer can nest a public channel into one of their own —
            into an existing channel or one created from the picker, so this
            shows even when they have none yet. */}
        {!channel.private && user ? (
          <ConnectChannelButton channelId={channel.id} channels={channels} />
        ) : null}
        <ExportChannelButton channel={channel} />
        {/* Admin moderation: delete someone else's public/open channel. */}
        {isAdmin && !isOwner && !channel.private ? (
          <AdminDeleteButton
            label="Delete channel"
            description="Delete this public channel and all of its blocks as an admin. This can’t be undone."
            onDelete={async () => {
              await adminDeleteChannelAction(channel.id);
              router.push(`/${handle}`);
            }}
          />
        ) : null}
        <ViewToggle view={view} onChange={setView} />
      </div>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h2 className="text-label">Description</h2>
          {channel.description ? <p className="">{channel.description}</p> : null}
        </div>
        {channel.tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {channel.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                #{tag}
              </Badge>
            ))}
          </div>
        ) : null}
        <ChannelMembersBar ownerHandle={handle} ownerAvatarUrl={ownerAvatarUrl} members={members} />
        <div className="flex flex-col">
          <h2 className="text-label">Meta</h2>
          {metaData.map((meta, index) => (
            <div key={index} className="flex w-full max-w-[350px] justify-between">
              <h3>{meta.title}</h3>
              <p className="font-mono">{meta.data}</p>
            </div>
          ))}
        </div>
      </div>

      {totalCount > 0 ? (
        <div className="flex flex-col gap-2">
          <ChannelControls
            search={search}
            onSearchChange={setSearch}
            type={typeFilter}
            onTypeChange={setTypeFilter}
            sort={sort}
            onSortChange={setSort}
          />
          {/* What the controls actually selected. The Meta panel's Length is the
              channel's, and stays the channel's; a search matching three blocks
              used to report the other four hundred and nothing else. */}
          <p className="text-caption" aria-live="polite">
            {loadingPage ? (
              <span className="inline-flex items-center gap-2">
                <GradientSpin cellSize={3} />
                Loading…
              </span>
            ) : isFiltered ? (
              `${filteredCount ?? columns.length} of ${totalCount} blocks`
            ) : (
              `${totalCount} blocks`
            )}
          </p>
          {/* Manual sort is selected but the board can't be arranged. Saying
              which of the two reasons applies is the difference between "this
              is broken" and "clear the search". */}
          {isOwner && sort === "manual" && isFiltered ? (
            <p className="text-caption">
              Clear the search and type filter to rearrange blocks — a drop inside a partial view
              can’t say where it lands.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Read out when a block is lifted, moved and dropped. Assertive because
          a move only exists as a change of position: with nothing announced,
          the arrow key does nothing a screen reader can report. */}
      <p aria-live="assertive" aria-atomic="true" className="sr-only">
        {reorder.message}
      </p>
      <p id={REORDER_HELP_ID} className="sr-only">
        Press space to lift this block, the arrow keys to move it, space again to drop it, and
        escape to put it back.
      </p>

      {!canContribute && totalCount === 0 ? (
        <p className="text-muted-foreground">No columns yet.</p>
      ) : (
        <>
          {/* The list on screen belongs to the previous selection until the new
              one lands: dimmed and inert rather than cleared, so a control
              change neither flashes an empty board nor reads as finished. */}
          <div
            ref={blockAreaRef}
            aria-busy={loadingPage}
            className={
              loadingPage && columns.length > 0
                ? "pointer-events-none opacity-50 transition-opacity"
                : "transition-opacity"
            }
          >
            {view === "list" ? (
              // Table view: the block input collapses behind an "Add block"
              // button, then a plain header + full-width rows (see column.tsx).
              <div className="flex flex-col gap-2">
                {canContribute ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setAdding(true)}
                  >
                    <Plus />
                    Add column
                  </Button>
                ) : null}
                <div>
                  {/* No header over an empty table — that reads as a rendering
                      failure rather than as "there is nothing here". */}
                  {columns.length === 0 && !loadingPage ? (
                    <EmptyBlocks filtered={isFiltered} />
                  ) : (
                    <>
                      <div className={`border-b px-2 py-2 text-label ${LIST_GRID}`}>
                        <span>Content</span>
                        <span>Title</span>
                        <span className="hidden sm:block">Author</span>
                        <span className="hidden sm:block">Added at</span>
                      </div>
                      {loadingPage && columns.length === 0
                        ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                            <BlockSkeleton view={view} key={i} />
                          ))
                        : columns.map((column, i) => (
                            <ColumnComponent
                              column={column}
                              screenshot={column.url ? screenshots.get(column.url) : undefined}
                              view={view}
                              author={handle}
                              onOpen={openBlock}
                              priority={i < EAGER_LIST_THUMBS}
                              reorderable={canReorder}
                              reorderActive={reorder.activeId === column.id}
                              reorderLifted={reorder.lifted}
                              onReorderPointerDown={reorder.onHandlePointerDown}
                              onReorderKeyDown={reorder.onHandleKeyDown}
                              onReorderBlur={reorder.onHandleBlur}
                              key={column.id}
                            />
                          ))}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid items-start gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {canContribute ? (
                  <ColumnInput
                    user={user}
                    columns={columns}
                    setColumns={setColumns}
                    channel={channel}
                    onBlockAdded={handleBlockAdded}
                    uploader={uploader}
                    onScreenshotStart={beginCapture}
                    onScreenshotReady={refreshScreenshot}
                  />
                ) : null}
                {loadingPage && columns.length === 0
                  ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                      <BlockSkeleton view={view} key={i} />
                    ))
                  : columns.map((column, i) => (
                      <ColumnComponent
                        column={column}
                        screenshot={column.url ? screenshots.get(column.url) : undefined}
                        view={view}
                        onOpen={openBlock}
                        // The add-block tile takes the first cell when it's there,
                        // pushing one block out of the top row.
                        priority={i < EAGER_GRID_THUMBS - (canContribute ? 1 : 0)}
                        reorderable={canReorder}
                        reorderActive={reorder.activeId === column.id}
                        reorderLifted={reorder.lifted}
                        onReorderPointerDown={reorder.onHandlePointerDown}
                        onReorderKeyDown={reorder.onHandleKeyDown}
                        onReorderBlur={reorder.onHandleBlur}
                        key={column.id}
                      />
                    ))}
              </div>
            )}
            {/* The grid's own empty state sits under the input tile, which stays
                available to add the first block. */}
            {view === "grid" && columns.length === 0 && !loadingPage ? (
              <EmptyBlocks filtered={isFiltered} />
            ) : null}
          </div>
          {/* Infinite-scroll sentinel + load-more spinner. */}
          <div ref={sentinelRef} className="h-1" />
          {loadingMore ? (
            <div className="w-full flex justify-center py-4">
              <GradientSpin cellSize={4} pattern="arrow-down" />
            </div>
          ) : null}
        </>
      )}

      <BlockModal
        column={openColumn}
        open={openId != null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
        isOwner={isOwner}
        canEdit={isOwner || (!!user && openColumn?.created_by === user.id)}
        isAdmin={isAdmin && !channel.private}
        handle={handle}
        viewerId={user?.id ?? null}
        setColumns={setColumns}
        channels={channels}
        screenshot={openColumn?.url ? screenshots.get(openColumn.url) : undefined}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />

      {/* Add-block modal (table view). handleBlockAdded closes it on success. */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add column</DialogTitle>
          </DialogHeader>
          <ColumnInput
            user={user}
            columns={columns}
            setColumns={setColumns}
            channel={channel}
            onBlockAdded={handleBlockAdded}
            uploader={uploader}
            onScreenshotStart={beginCapture}
            onScreenshotReady={refreshScreenshot}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
