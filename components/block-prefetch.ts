"use client";

// Hover timing for the block-media prefetch. The fetching itself is in
// lib/prefetch.ts, which stays React-free so it can be unit-tested.

import { useCallback, useEffect, useRef } from "react";

import type { Column } from "@/lib/colosseum/column";
import { PREFETCH_DELAY_MS, prefetchBlockMedia } from "@/lib/prefetch";

// Handlers to spread onto a block's card. Hovering (or tabbing to) the card
// starts the prefetch after a short pause; leaving before it elapses cancels,
// so a pointer crossing the grid doesn't pull a full-size image per card.
export function useBlockMediaPrefetch(column: Column) {
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
      prefetchBlockMedia(column);
    }, PREFETCH_DELAY_MS);
  }, [column]);

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
