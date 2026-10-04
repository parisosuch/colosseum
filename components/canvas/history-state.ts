"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getCanvasVersionPreviewAction } from "@/lib/colosseum/actions";
import type { CanvasVersion } from "@/lib/colosseum/canvas-version";
import type { CanvasStore } from "./canvas-store";
import { closePreviewStore, createPreviewStore } from "./history-preview";

export type HistoryPreview = {
  version: CanvasVersion;
  // Null while the version's doc loads; the live board stays drawn till then.
  store: CanvasStore | null;
};

export type CanvasHistory = {
  // Channel managers only.
  enabled: boolean;
  channelId: number;
  live: CanvasStore;
  open: boolean;
  setOpen: (open: boolean) => void;
  preview: HistoryPreview | null;
  openVersion: (version: CanvasVersion) => void;
  closePreview: () => void;
};

// The history panel's open state and the version being previewed. The page
// draws `preview.store` in place of the live store while there is one, and
// hides everything that edits.
export function useCanvasHistory(
  live: CanvasStore,
  channelId: number,
  enabled: boolean,
): CanvasHistory {
  const [open, setOpenState] = useState(false);
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  // The store on screen, for teardown outside a state updater, and the latest
  // request, so a slow preview that's been replaced is dropped.
  const shown = useRef<CanvasStore | null>(null);
  const request = useRef(0);

  const dropShown = useCallback(() => {
    if (shown.current) closePreviewStore(shown.current, live);
    shown.current = null;
  }, [live]);

  const closePreview = useCallback(() => {
    request.current++;
    dropShown();
    setPreview(null);
  }, [dropShown]);

  const openVersion = useCallback(
    (version: CanvasVersion) => {
      const id = ++request.current;
      dropShown();
      setPreview({ version, store: null });
      // Nothing on the live board stays selected or edited behind the
      // preview, and this manager's cursor leaves the others' screens.
      live.setEditing(null);
      live.setSelection([]);
      live.setCursor(null);
      void getCanvasVersionPreviewAction(channelId, version.id)
        .then(({ doc }) => {
          if (request.current !== id) return;
          const store = createPreviewStore(live, doc);
          shown.current = store;
          setPreview({ version, store });
        })
        .catch((err) => {
          if (request.current !== id) return;
          console.error(err);
          toast.error("Couldn't open that version. Please try again.");
          setPreview(null);
        });
    },
    [channelId, dropShown, live],
  );

  const setOpen = useCallback(
    (next: boolean) => {
      // The panel sits where the properties panel does, so opening it lets go
      // of the selection; closing it leaves any preview too.
      if (next) live.setSelection([]);
      else closePreview();
      setOpenState(next);
    },
    [closePreview, live],
  );

  // Selecting something on the live board closes the panel, as the design's
  // floating panels close on their own.
  useEffect(() => {
    if (!open || preview) return;
    return live.subscribe("selection", () => {
      if (live.selection.size > 0) setOpenState(false);
    });
  }, [live, open, preview]);

  // Esc leaves a preview, unless a dialog or a field has it.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      closePreview();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview, closePreview]);

  // Losing manager rights (or the page going away) ends any preview.
  useEffect(() => {
    if (!enabled) {
      closePreview();
      setOpenState(false);
    }
  }, [enabled, closePreview]);
  useEffect(
    () => () => {
      request.current++;
      shown.current?.destroy();
      shown.current = null;
    },
    [],
  );

  return { enabled, channelId, live, open, setOpen, preview, openVersion, closePreview };
}
