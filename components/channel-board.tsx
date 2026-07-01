"use client";

import BrandLink from "@/components/brand-link";
import ColumnComponent from "@/components/column";
import ManageChannelButton from "@/components/manage-channel-button";
import ExportChannelButton from "@/components/export-channel-button";
import ColumnInput from "@/components/column-input";
import ChannelControls from "@/components/channel-controls";
import { Spinner } from "@/components/ui/spinner";
import { Channel } from "@/lib/colosseum/channel";
import { Column, ColumnFilter, ColumnSort, getChannelColumns } from "@/lib/colosseum/column";
import { ColumnScreenshot, getScreenshotsForUrls } from "@/lib/colosseum/screenshot-data";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

// How many blocks to load per page (initial load and each load-more).
const PAGE_SIZE = 50;
// Placeholder tiles shown while the first page loads — a few rows' worth.
const SKELETON_COUNT = 18;

// One placeholder tile, sized identically to a real block: a square preview
// plus one reserved caption line. Keeps the grid from reflowing when blocks
// swap in.
function BlockSkeleton() {
  return (
    <div className="w-full">
      <div className="w-full aspect-square border rounded-lg bg-muted animate-pulse" />
      <p className="pt-1 text-xs">
        <span className="inline-block h-3 w-2/3 rounded bg-muted align-middle animate-pulse" />
      </p>
    </div>
  );
}

type ChannelBoardProps = {
  channel: Channel;
  handle: string;
  isOwner: boolean;
  user: User | null;
  initialCount: number;
  newestAt: string | null;
  // Created-on formatted on the server, so the absolute date can't shift with
  // the client timezone and cause a hydration mismatch.
  createdOnLabel: string;
};

export default function ChannelBoard({
  channel: initialChannel,
  handle,
  isOwner,
  user,
  initialCount,
  newestAt: initialNewestAt,
  createdOnLabel,
}: ChannelBoardProps) {
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [columns, setColumns] = useState<Column[]>([]);
  const [screenshots, setScreenshots] = useState<Map<string, ColumnScreenshot>>(new Map());

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

  // Paging state for the current control selection.
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const supabase = createClient();

  const isFiltered = debouncedSearch.trim() !== "" || typeFilter !== "all";

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

  // Load (or reload) the first page whenever the channel or any control changes.
  // The previous list stays on screen until the new one resolves, so changing a
  // control doesn't flash an empty grid.
  useEffect(() => {
    let cancelled = false;
    setLoadingPage(true);
    (async () => {
      try {
        const first = await getChannelColumns(supabase, channel.id, {
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
        if (!cancelled) toast.error("Failed to load blocks.");
      } finally {
        if (!cancelled) setLoadingPage(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channel.id, debouncedSearch, typeFilter, sort, supabase]);

  // Append the next page. Offset is the count already loaded.
  const loadMore = useCallback(async () => {
    if (loadingMore || loadingPage || !hasMore) return;

    setLoadingMore(true);
    try {
      const next = await getChannelColumns(supabase, channel.id, {
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
    supabase,
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
      .filter((c) => c.type === "url" && c.url && !screenshots.has(c.url))
      .map((c) => c.url!);

    if (missing.length === 0) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const fetched = await getScreenshotsForUrls(supabase, missing);
        if (cancelled) return;
        setScreenshots((prev) => {
          const next = new Map(prev);
          // Record every requested URL so a missing screenshot resolves to a
          // null image (and isn't refetched on the next render).
          for (const url of missing) {
            next.set(
              url,
              fetched.get(url) ?? { url, image_url: null, title: null, captured_at: null },
            );
          }
          return next;
        });
      } catch (e) {
        console.error(e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [columns, screenshots, supabase]);

  // A new block is the newest and bumps the channel length; reflect that in the
  // stats without refetching the whole channel.
  const handleBlockAdded = useCallback(() => {
    setTotalCount((c) => c + 1);
    setNewestAt(new Date().toISOString());
  }, []);

  return (
    <div className="w-full p-6 sm:p-12 space-y-8">
      <h1 className="text-2xl sm:text-4xl">
        <BrandLink /> <span className="font-extralight">/</span>{" "}
        <Link
          href={`/${handle}`}
          className="dark:text-white/75 text-black/75 hover:dark:text-white/100 hover:text-black/100"
        >
          {handle}
        </Link>{" "}
        <span className="font-extralight">/</span> {channel.title}
      </h1>
      <div className="flex items-center gap-2">
        {isOwner ? (
          <ManageChannelButton channel={channel} handle={handle} onUpdated={setChannel} />
        ) : null}
        <ExportChannelButton channel={channel} />
      </div>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Description</h2>
          {channel.description ? <p className="">{channel.description}</p> : null}
        </div>
        <div className="flex flex-col">
          <h2 className="text-sm font-light">Meta</h2>
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

      {!isOwner && totalCount === 0 ? (
        <p className="text-black/50 dark:text-white/50">No blocks yet.</p>
      ) : (
        <>
          <div
            className="grid gap-4
                grid-cols-2
                md:grid-cols-3
                lg:grid-cols-4
                xl:grid-cols-5
                2xl:grid-cols-6"
          >
            {isOwner ? (
              <ColumnInput
                user={user}
                columns={columns}
                setColumns={setColumns}
                channel={channel}
                onBlockAdded={handleBlockAdded}
              />
            ) : null}
            {loadingPage && columns.length === 0
              ? Array.from({ length: SKELETON_COUNT }).map((_, i) => <BlockSkeleton key={i} />)
              : columns.map((column) => (
                  <ColumnComponent
                    column={column}
                    isOwner={isOwner}
                    handle={handle}
                    setColumns={setColumns}
                    screenshot={column.url ? screenshots.get(column.url) : undefined}
                    key={column.id}
                  />
                ))}
          </div>

          {!loadingPage && columns.length === 0 ? (
            <p className="text-black/50 dark:text-white/50">
              {isFiltered ? "No blocks match your search." : "No blocks yet."}
            </p>
          ) : null}

          {/* Infinite-scroll sentinel + load-more spinner. */}
          <div ref={sentinelRef} className="h-1" />
          {loadingMore ? (
            <div className="w-full flex justify-center py-4">
              <Spinner variant="circle" className="size-6 text-black/30 dark:text-white/30" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
