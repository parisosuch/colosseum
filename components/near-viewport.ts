"use client";

// React side of the card-media gate: binds a card element to the shared
// IntersectionObserver in lib/near-viewport.ts and reports whether the card is
// close enough to the viewport to be worth rendering its media. The observer
// bookkeeping lives in lib/near-viewport.ts, which stays React-free so it can be
// unit-tested — the same split as lib/prefetch.ts and components/block-prefetch.ts.

import { useCallback, useEffect, useRef, useState } from "react";

import { createNearViewport } from "@/lib/near-viewport";

// One watcher for the whole page, built lazily so a server render never touches
// IntersectionObserver.
let shared: ReturnType<typeof createNearViewport> | null = null;

function watcher() {
  shared ??= createNearViewport((callback, options) => new IntersectionObserver(callback, options));
  return shared;
}

// Whether this card is near the viewport, plus the ref to hang on it.
//
// Starts near, so the server-rendered first page and every freshly appended
// page paint exactly what they paint today — the gate only ever takes media
// away, once the observer has confirmed the card is nowhere near. Starting
// parked instead would blank the rows below the priority thumbnails until
// hydration, which is the one way this can make the page feel slower.
export function useNearViewport(): {
  ref: (element: HTMLElement | null) => void;
  near: boolean;
} {
  const [near, setNear] = useState(true);
  const stop = useRef<(() => void) | null>(null);
  const isNear = useRef(true);

  const ref = useCallback((element: HTMLElement | null) => {
    stop.current?.();
    stop.current = null;
    if (!element || typeof IntersectionObserver === "undefined") return;
    stop.current = watcher().watch(element, isNear.current, (value) => {
      isNear.current = value;
      setNear(value);
    });
  }, []);

  // The ref callback's cleanup covers a card being replaced; this covers the
  // card unmounting with the rest of the grid.
  useEffect(
    () => () => {
      stop.current?.();
      stop.current = null;
    },
    [],
  );

  return { ref, near };
}
