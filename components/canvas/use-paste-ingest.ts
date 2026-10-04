"use client";

import { useEffect } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import {
  addFailureMessage,
  createFileBlock,
  createImageBlockFromUrl,
  createUrlBlock,
} from "@/components/block-ingest";
import type { Column } from "@/lib/colosseum/column";
import type { CanvasStore } from "./canvas-store";
import { registerIngest } from "./paste-ingest";

// Give the board what pastes and drops need to create blocks in `channelId`.
// `addColumns` is the page's: a new block goes into its map before the
// element that points at it, so the board never waits on a fetch for it.
export function usePasteIngest(
  store: CanvasStore,
  channelId: number,
  addColumns: (columns: Column[]) => void,
): void {
  useEffect(
    () =>
      registerIngest(store, {
        createFile: (file) => createFileBlock(channelId, file),
        createFromImageUrl: (url) => createImageBlockFromUrl(channelId, url),
        createUrl: (url) => createUrlBlock(channelId, url),
        // Flushed, so the block is in the page's map by the time its element
        // lands; otherwise one render sees a placed block it doesn't have and
        // brings the loader back over the board.
        addColumns: (columns) => flushSync(() => addColumns(columns)),
        failureMessage: (e) => addFailureMessage(e, "Couldn't add that block. Please try again."),
        error: (message) => toast.error(message),
      }),
    [store, channelId, addColumns],
  );
}
