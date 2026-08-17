"use client";

// React side of the block prefetch: hover timing for a card in the grid, and
// warming the open block's neighbours while the modal is up. The fetching and
// the neighbour arithmetic live in lib/prefetch.ts and lib/comment-cache.ts,
// which stay React-free so they can be unit-tested.

import { useCallback, useEffect, useRef } from "react";

import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { fetchComments } from "@/lib/comment-cache";
import { getColumnCommentsAction } from "@/lib/colosseum/actions";
import {
  PREFETCH_DELAY_MS,
  neighbourBlocks,
  preconnectBlockOrigins,
  prefersReducedData,
  prefetchBlockMedia,
} from "@/lib/prefetch";

// Handlers to spread onto a block's card. Hovering (or tabbing to) the card
// starts the prefetch after a short pause; leaving before it elapses cancels,
// so a pointer crossing the grid doesn't pull a full-size image per card.
// `screenshot` is the board's cached row for a URL block, which is what the
// modal renders.
export function useBlockMediaPrefetch(column: Column, screenshot?: ColumnScreenshot) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      prefetchBlockMedia(column, screenshot);
      preconnectBlockOrigins(column);
    }, PREFETCH_DELAY_MS);
  }, [column, screenshot]);

  // Don't leave a timer behind for a card that unmounted — a filter change or
  // a navigation swaps the whole grid out from under the pointer.
  useEffect(() => cancel, [cancel]);

  return {
    onPointerEnter: schedule,
    onPointerLeave: cancel,
    onFocus: schedule,
    onBlur: cancel,
  };
}

// Warm the blocks either side of the open one, so a ← / → step paints from
// cache instead of starting a cold fetch and streaming the image in.
// `openIndex` is -1 when nothing is open, which warms nothing. `screenshots` is
// the board's batched map keyed by block URL, the same one the modal reads.
//
// The effect re-runs whenever the board hands over a new `columns` array — a
// page appending, a control change, the screenshot poll rewriting state — so
// every part has to be idempotent, and each is: `prefetchBlockMedia` keeps a
// per-URL requested set, `preconnectBlockOrigins` keeps a per-origin one, and
// the comment cache treats a thread inside its freshness window as current and
// shares a request already in flight.
export function useNeighbourPrefetch(
  columns: Column[],
  openIndex: number,
  screenshots?: Map<string, ColumnScreenshot>,
) {
  useEffect(() => {
    if (prefersReducedData()) return;
    for (const column of neighbourBlocks(columns, openIndex)) {
      prefetchBlockMedia(column, column.url ? screenshots?.get(column.url) : undefined);
      preconnectBlockOrigins(column);
      // Ignored on failure: a warm that 404s or is refused costs the viewer
      // nothing, and the panel surfaces the real error if they step onto it.
      fetchComments(column.id, getColumnCommentsAction).catch(() => {});
    }
  }, [columns, openIndex, screenshots]);
}
