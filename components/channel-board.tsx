"use client";

import PageHeader from "@/components/page-header";
import ColumnComponent, { LIST_GRID } from "@/components/column";
import BlockModal from "@/components/block-modal";
import ConnectChannelButton from "@/components/connect-channel-button";
import type { PickableChannel } from "@/components/add-block-drawer";
import ManageChannelButton from "@/components/manage-channel-button";
import ChannelMembersBar from "@/components/channel-members-bar";
import ExportChannelButton from "@/components/export-channel-button";
import { ViewToggle } from "@/components/view-toggle";
import { PAGE_SIZE } from "@/lib/pagination";
import ColumnInput from "@/components/column-input";
import ChannelControls from "@/components/channel-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { Channel } from "@/lib/colosseum/channel";
import type { ChannelMember } from "@/lib/colosseum/member";
import type { Column, ColumnFilter, ColumnSort } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { getChannelColumnsAction, getScreenshotsForUrlsAction } from "@/lib/colosseum/actions";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

// Placeholder tiles shown while the first page loads — a few rows' worth.
const SKELETON_COUNT = 18;

// One placeholder tile, sized to match a real block in the current view (square
// card in grid, compact row in list). Keeps the layout from reflowing when
// blocks swap in.
function BlockSkeleton({ view }: { view: "grid" | "list" }) {
  if (view === "list") {
    return (
      <div className={`border-b px-2 py-2 ${LIST_GRID}`}>
        <div className="flex items-center gap-2">
          <div className="size-10 shrink-0 rounded-md bg-muted animate-pulse" />
          <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
        <div className="hidden h-4 w-2/3 rounded bg-muted animate-pulse sm:block" />
        <div className="hidden h-3 w-1/2 rounded bg-muted animate-pulse sm:block" />
      </div>
    );
  }
  return (
    <div className="w-full">
      <div className="w-full aspect-square border rounded-lg bg-muted animate-pulse" />
      <p className="pt-1 text-xs">
        <span className="inline-block h-3 w-2/3 rounded bg-muted align-middle animate-pulse" />
      </p>
    </div>
  );
}

// The slice of the session user the board (and ColumnInput) actually needs —
// the channel page passes the Better Auth session user, which satisfies this.
export type SessionUser = { id: string };

type ChannelBoardProps = {
  channel: Channel;
  handle: string;
  isOwner: boolean;
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
};

export default function ChannelBoard({
  channel: initialChannel,
  handle,
  isOwner,
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
}: ChannelBoardProps) {
  const [members, setMembers] = useState<ChannelMember[]>(initialMembers);
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [columns, setColumns] = useState<Column[]>(initialColumns);
  const [screenshots, setScreenshots] = useState<Map<string, ColumnScreenshot>>(
    () => new Map(initialScreenshots),
  );

  // Channel-wide stats, kept independent of the paged/filtered `columns` list so
  // the meta panel always reflects the whole channel.
  const [totalCount, setTotalCount] = useState(initialCount);
  const [newestAt, setNewestAt] = useState<string | null>(initialNewestAt);

  // Search / filter / sort controls. `debouncedSearch` is what actually drives
  // the query, so typing doesn't fire a request per keystroke.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ColumnFilter>("all");
  const [sort, setSort] = useState<ColumnSort>("newest");

  // Paging state for the current control selection. Seeded from the
  // server-rendered first page, so nothing loads on mount.
  const [loadingPage, setLoadingPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialColumns.length === PAGE_SIZE);

  // Grid (square cards) vs list (Are.na-style table) layout for the block area.
  const [view, setView] = useState<"grid" | "list">("grid");
  // In table view the block input is collapsed behind an "Add block" button.
  const [adding, setAdding] = useState(false);

  // Which block's modal is open, so it can step to a sibling block in place.
  const [openId, setOpenId] = useState<number | null>(null);
  const openBlock = useCallback((id: number) => setOpenId(id), []);

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
  // ponytail: fixed poll interval + attempt cap (no websocket/SSE); bump this
  // to re-run the hydrate effect on a timer.
  const [pollTick, setPollTick] = useState(0);
  const SCREENSHOT_POLL_MS = 5000;
  const SCREENSHOT_MAX_RETRIES = 60; // ~5 minutes before settling on "no preview"

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

  // Load (or reload) the first page whenever the channel or any control changes.
  // The previous list stays on screen until the new one resolves, so changing a
  // control doesn't flash an empty grid.
  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }

    let cancelled = false;
    setLoadingPage(true);
    (async () => {
      try {
        const first = await getChannelColumnsAction(channel.id, {
          search: debouncedSearch,
          type: typeFilter,
          sort,
          limit: PAGE_SIZE,
          offset: 0,
        });
        if (cancelled) return;
        setColumns(first);
        setHasMore(first.length === PAGE_SIZE);
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
  }, [channel.id, debouncedSearch, typeFilter, sort]);

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
    const missing = columns
      .filter((c) => c.type === "url" && c.url && !screenshots.has(c.url) && !capturing.has(c.url))
      .map((c) => c.url!);

    if (missing.length === 0) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const fetched = new Map(await getScreenshotsForUrlsAction(missing));
        if (cancelled) return;

        // Collect into a plain Map first and only call setScreenshots if
        // something actually resolved. `screenshots` is a dependency of this
        // same effect — writing a new Map reference on every round (even one
        // where every URL is still pending) would retrigger this effect
        // immediately, cascading into itself and orphaning every scheduled
        // poll timer below (each instance gets cancelled by the next before
        // its own timer fires). Skipping the write when nothing changed is
        // what keeps the 5s cadence real instead of racing itself.
        let stillPending = false;
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
          if (attempts >= SCREENSHOT_MAX_RETRIES) {
            updates.set(url, { url, image_url: null, title: null, captured_at: null });
          } else {
            stillPending = true;
          }
        }

        if (updates.size > 0) {
          setScreenshots((prev) => {
            const next = new Map(prev);
            for (const [url, row] of updates) next.set(url, row);
            return next;
          });
        }

        if (stillPending) {
          setTimeout(() => {
            if (!cancelled) setPollTick((t) => t + 1);
          }, SCREENSHOT_POLL_MS);
        }
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pollTick only retriggers the effect; it's not read inside.
  }, [columns, screenshots, capturing, pollTick]);

  // A new block is the newest and bumps the channel length; reflect that in the
  // stats without refetching the whole channel.
  const handleBlockAdded = useCallback(() => {
    setTotalCount((c) => c + 1);
    setNewestAt(new Date().toISOString());
    // Close the table view's add-block modal.
    setAdding(false);
  }, []);

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

  // Step the open modal to an adjacent block. Clamps at the ends.
  const navigate = useCallback(
    (dir: -1 | 1) => {
      setOpenId((cur) => {
        if (cur == null) return cur;
        const i = columns.findIndex((c) => c.id === cur);
        return columns[i + dir]?.id ?? cur;
      });
    },
    [columns],
  );

  const openIndex = openId == null ? -1 : columns.findIndex((c) => c.id === openId);
  const openColumn = openIndex >= 0 ? columns[openIndex] : null;
  const hasPrev = openIndex > 0;
  const hasNext = openIndex >= 0 && openIndex < columns.length - 1;

  // If the open block leaves the list (deleted, or filtered out by a control
  // change), close the modal instead of stranding it on a gone block.
  useEffect(() => {
    if (openId != null && !columns.some((c) => c.id === openId)) setOpenId(null);
  }, [columns, openId]);

  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
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
        {/* Any signed-in viewer can nest a public channel into one of their own. */}
        {!channel.private ? (
          <ConnectChannelButton channelId={channel.id} channels={channels} />
        ) : null}
        <ExportChannelButton channel={channel} />
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
        <ChannelControls
          search={search}
          onSearchChange={setSearch}
          type={typeFilter}
          onTypeChange={setTypeFilter}
          sort={sort}
          onSortChange={setSort}
        />
      ) : null}

      {!canContribute && totalCount === 0 ? (
        <p className="text-muted-foreground">No columns yet.</p>
      ) : (
        <>
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
                  : columns.map((column) => (
                      <ColumnComponent
                        column={column}
                        screenshot={column.url ? screenshots.get(column.url) : undefined}
                        view={view}
                        author={handle}
                        onOpen={openBlock}
                        key={column.id}
                      />
                    ))}
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
                  onScreenshotStart={beginCapture}
                  onScreenshotReady={refreshScreenshot}
                />
              ) : null}
              {loadingPage && columns.length === 0
                ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                    <BlockSkeleton view={view} key={i} />
                  ))
                : columns.map((column) => (
                    <ColumnComponent
                      column={column}
                      screenshot={column.url ? screenshots.get(column.url) : undefined}
                      view={view}
                      onOpen={openBlock}
                      key={column.id}
                    />
                  ))}
            </div>
          )}
          {/* Infinite-scroll sentinel + load-more spinner. */}
          <div ref={sentinelRef} className="h-1" />
          {loadingMore ? (
            <div className="w-full flex justify-center py-4">
              <Spinner variant="circle" className="size-6 text-muted-foreground" />
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
            onScreenshotStart={beginCapture}
            onScreenshotReady={refreshScreenshot}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
