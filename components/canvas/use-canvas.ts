"use client";

import { useSyncExternalStore } from "react";

import type { CanvasStore } from "./canvas-store";

// Subscribe to one slice of the canvas store. `read` must return a value that
// only changes identity when the slice changes, which the store's fields do.
export function useCanvas<T>(
  store: CanvasStore,
  slice: Parameters<CanvasStore["subscribe"]>[0],
  read: (store: CanvasStore) => T,
): T {
  return useSyncExternalStore(
    (onChange) => store.subscribe(slice, onChange),
    () => read(store),
    () => read(store),
  );
}
