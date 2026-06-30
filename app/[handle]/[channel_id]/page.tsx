"use client";

import BrandLink from "@/components/brand-link";
import ColumnComponent from "@/components/column";
import ManageChannelButton from "@/components/manage-channel-button";
import ExportChannelButton from "@/components/export-channel-button";
import ColumnInput from "@/components/column-input";
import ChannelControls from "@/components/channel-controls";
import { Spinner } from "@/components/ui/spinner";
import { Channel, getChannel } from "@/lib/colosseum/channel";
import {
  Column,
  ColumnFilter,
  ColumnSort,
  getChannelColumnCount,
  getChannelColumns,
} from "@/lib/colosseum/column";
import { ColumnScreenshot, getScreenshotsForUrls } from "@/lib/colosseum/screenshot-data";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

// How many blocks to load per page (initial load and each load-more).
const PAGE_SIZE = 50;

export default function ChannelPage() {
  const params = useParams();
  const handle = params.handle as string;
  const channel_id = params.channel_id as string;

  const [channel, setChannel] = useState<Channel | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [screenshots, setScreenshots] = useState<Map<string, ColumnScreenshot>>(new Map());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  // Channel-wide stats, kept independent of the paged/filtered `columns` list so
  // the meta panel always reflects the whole channel.
  const [totalCount, setTotalCount] = useState(0);
  const [newestAt, setNewestAt] = useState<string | null>(null);

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

  const router = useRouter();
  const supabase = createClient();

  const isFiltered = debouncedSearch.trim() !== "" || typeFilter !== "all";

  const metaData = useMemo(() => {
    if (!channel) return [];

    let lastModified = "-";
    if (newestAt) {
      const diffInDays = Math.floor((Date.now() - new Date(newestAt).getTime()) / 86400000);
      lastModified = diffInDays === 0 ? "Today" : `${diffInDays} days ago`;
    }

    return [
      {
        title: "Created On",
        data: new Date(channel.created_at).toLocaleString("default", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      },
      { title: "Last Modified", data: lastModified },
      { title: "Length", data: totalCount.toString() },
    ];
  }, [channel, newestAt, totalCount]);

  // Load the channel, resolve ownership/visibility, and seed the channel-wide
  // stats. The block list itself is loaded by the paging effect below once the
  // channel is set.
  useEffect(() => {
    if (!channel_id) {
      return;
    }

    let cancelled = false;
    const id = parseInt(channel_id, 10);

    (async () => {
      setLoading(true);
      try {
        const channelResponse = await getChannel(supabase, id);
        if (!channelResponse) {
          // null = the channel doesn't exist or RLS hides it from this user
          // (e.g. a private channel they don't own). Don't leak which; redirect.
          router.push("/");
          return;
        }

        const { data: userData } = await supabase.auth.getUser();
        const currentUser = userData.user;

        if (channelResponse.private) {
          if (!currentUser || currentUser.id !== channelResponse.owner_id) {
            router.push("/"); // redirect safely in client component
            return;
          }
        }

        const [count, newest] = await Promise.all([
          getChannelColumnCount(supabase, id),
          getChannelColumns(supabase, id, { sort: "newest", limit: 1 }),
        ]);

        if (cancelled) return;

        setChannel(channelResponse);
        setUser(currentUser);
        setIsOwner(!!currentUser && channelResponse.owner_id === currentUser.id);
        setTotalCount(count);
        setNewestAt(newest[0]?.created_at ?? null);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setFetchError(true);
          toast.error("Failed to load channel.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channel_id, supabase, router]);

  // Debounce the search box so each keystroke doesn't fire a query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load (or reload) the first page whenever the channel or any control changes.
  // The previous list stays on screen until the new one resolves, so changing a
  // control doesn't flash an empty grid.
  useEffect(() => {
    if (!channel) return;

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
  }, [channel, debouncedSearch, typeFilter, sort, supabase]);

  // Append the next page. Offset is the count already loaded.
  const loadMore = useCallback(async () => {
    if (!channel || loadingMore || loadingPage || !hasMore) return;

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
    channel,
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
  }, [loading]);

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

  if (loading) {
    return (
      <div className="w-full h-[60vh] flex items-center justify-center">
        <Spinner variant="circle" className="size-8 text-black/30 dark:text-white/30" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="w-full p-12 space-y-2">
        <h1 className="text-4xl">
          <BrandLink /> <span className="font-extralight">/ {handle}</span>
        </h1>
        <p className="text-black/50 dark:text-white/50">
          Something went wrong loading this channel.
        </p>
      </div>
    );
  }

  // `channel` stays null while a redirect (not-found / RLS-hidden) is in
  // flight, so guard on it too — `loading` is already false by then.
  if (!channel) {
    return null;
  }

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
                2xl:grid-cols-6
                3xl:grid-cols-7"
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
            {columns.map((column) => (
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
