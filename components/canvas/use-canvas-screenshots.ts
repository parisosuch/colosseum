"use client";

import { useEffect, useRef, useState } from "react";

import { getScreenshotsForUrlsAction } from "@/lib/colosseum/actions";
import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { SCREENSHOT_MAX_ATTEMPTS, nextScreenshotPoll, whenVisible } from "@/lib/screenshot-poll";

const NONE = (url: string): ColumnScreenshot => ({
  url,
  image_url: null,
  title: null,
  captured_at: null,
});

// Screenshots for the link blocks the canvas knows about, on the channel
// grid's schedule (lib/screenshot-poll.ts). A link pasted onto the board, or
// added in another tab, has no screenshot for its first few seconds, so a URL
// with no row yet is asked about again with backoff until one lands or the
// attempts run out. A row with no image is a capture that failed: settled.
export function useCanvasScreenshots(
  columns: ReadonlyMap<number, Column | null>,
): ReadonlyMap<string, ColumnScreenshot> {
  const [screenshots, setScreenshots] = useState<Map<string, ColumnScreenshot>>(() => new Map());
  const attempts = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const missing = [
      ...new Set(
        [...columns.values()]
          .filter((c): c is Column => !!c && c.type === "url" && !!c.url)
          .map((c) => c.url!)
          .filter((u) => !screenshots.has(u)),
      ),
    ];
    if (missing.length === 0) return;
    if (document.hidden) return whenVisible(document, () => setTick((t) => t + 1));

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopWaiting: (() => void) | null = null;
    void (async () => {
      try {
        const got = new Map(await getScreenshotsForUrlsAction(missing));
        if (cancelled) return;
        let pending: number | null = null;
        const updates = new Map<string, ColumnScreenshot>();
        for (const url of missing) {
          const row = got.get(url);
          if (row) {
            updates.set(url, row);
            attempts.current.delete(url);
            continue;
          }
          const n = (attempts.current.get(url) ?? 0) + 1;
          attempts.current.set(url, n);
          if (n >= SCREENSHOT_MAX_ATTEMPTS) updates.set(url, NONE(url));
          else pending = Math.min(pending ?? n, n);
        }
        // Only write when something settled: `screenshots` is this effect's
        // dependency, and a new map every round would restart it at once.
        if (updates.size > 0) {
          setScreenshots((prev) => {
            const next = new Map(prev);
            for (const [url, row] of updates) next.set(url, row);
            return next;
          });
        }
        const decision = nextScreenshotPoll(pending, document.hidden);
        if (decision.kind === "schedule") {
          timer = setTimeout(() => {
            if (!cancelled) setTick((t) => t + 1);
          }, decision.delayMs);
        } else if (decision.kind === "await-visible") {
          stopWaiting = whenVisible(document, () => {
            if (!cancelled) setTick((t) => t + 1);
          });
        }
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      stopWaiting?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick only re-runs the round.
  }, [columns, screenshots, tick]);

  return screenshots;
}
