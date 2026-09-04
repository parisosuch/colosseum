"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

import { loadMoreActivity } from "@/app/explore/actions";
import { GradientSpin } from "@/components/gradient-spin";
import { Button } from "@/components/ui/button";

// Infinite scroll for the Explore feed. Renders as flex siblings of the initial
// rows (so they share the container's gap), appending each server-rendered page
// as an IntersectionObserver sentinel nears the viewport and advancing the
// cursor. Mirrors the channel board's sentinel-based paging.
export function ExploreLoadMore({
  initialCursor,
  initialHasMore,
  signedIn,
}: {
  initialCursor: string | null;
  initialHasMore: boolean;
  // Gates the onward link at the end of the feed: /users is behind the login
  // gate, and Explore itself is public.
  signedIn: boolean;
}) {
  const [pages, setPages] = useState<ReactNode[]>([]);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  // Set when a page fails. While it's set the sentinel stops firing, so a
  // broken connection doesn't spin on every scroll — the reader retries.
  const [failed, setFailed] = useState(false);

  // `force` is the retry: it's the one caller allowed through after a failure.
  const loadMore = async (force = false) => {
    if (!cursor || loading || !hasMore || (failed && !force)) return;
    setFailed(false);
    setLoading(true);
    try {
      const res = await loadMoreActivity(cursor);
      setPages((prev) => [...prev, res.rows]);
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
    } catch (e) {
      console.error(e);
      setFailed(true);
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
      {loading ? (
        <div className="flex w-full items-center justify-center">
          <GradientSpin cellSize={4} pattern="arrow-down" />
        </div>
      ) : null}
      {failed ? (
        <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load more activity.</p>
          <Button variant="outline" onClick={() => loadMore(true)}>
            <RotateCw />
            Try again
          </Button>
        </div>
      ) : null}
      {/* The true end of the feed, so it reads as "that's everything" rather
          than as a page that quietly stopped loading. */}
      {!hasMore && !loading && !failed ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
          {signedIn ? (
            <Link href="/users" className="text-sm underline underline-offset-4">
              See how everyone here is connected
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
