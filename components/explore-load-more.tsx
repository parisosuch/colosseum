"use client";

import { Fragment, useState, type ReactNode } from "react";

import { loadMoreActivity } from "@/app/explore/actions";
import { Button } from "@/components/ui/button";

// Client "load more" for the Explore feed. Renders as flex siblings of the
// initial rows (so they share the container's gap), appending each server-
// rendered page and advancing the cursor.
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

  const onClick = async () => {
    if (!cursor || loading) return;
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

  return (
    <>
      {pages.map((page, i) => (
        <Fragment key={i}>{page}</Fragment>
      ))}
      {hasMore ? (
        <Button variant="outline" onClick={onClick} disabled={loading}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </>
  );
}
