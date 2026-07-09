"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { loadMoreActivity } from "@/app/explore/actions";
import { Spinner } from "@/components/ui/spinner";

// Infinite scroll for the Explore feed. Renders as flex siblings of the initial
// rows (so they share the container's gap), appending each server-rendered page
// as an IntersectionObserver sentinel nears the viewport and advancing the
// cursor. Mirrors the channel board's sentinel-based paging.
export function ExploreLoadMore({
  initialCursor,
  initialHasMore,
}: {
  initialCursor: string | null;
  initialHasMore: boolean;
}) {
  const [pages, setPages] = useState<ReactNode[]>([]);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);

  const loadMore = async () => {
    if (!cursor || loading || !hasMore) return;
    setLoading(true);
    try {
      const res = await loadMoreActivity(cursor);
      setPages((prev) => [...prev, res.rows]);
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // A ref keeps the observer callback pointed at the latest loadMore (current
  // cursor/loading/hasMore) without re-creating the observer every render.
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

  return (
    <>
      {pages.map((page, i) => (
        <Fragment key={i}>{page}</Fragment>
      ))}
      {/* Sentinel: loads the next page as it nears the viewport. */}
      <div ref={sentinelRef} className="h-1 w-full" />
      {loading ? <Spinner variant="circle" className="size-6 text-muted-foreground" /> : null}
    </>
  );
}
