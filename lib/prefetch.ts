// Warms the browser's cache for a block's full-size media while the pointer is
// still resting on its card, so opening the modal paints the image in one go
// instead of streaming it in top-to-bottom.
//
// Only image blocks are worth prefetching. The grid card shows a downsized
// `?thumb`, so the modal's full-size fetch always starts cold — that's the
// visible top-to-bottom render. The other types have nothing to gain: a video
// streams as it plays, a PDF renders progressively inside its own viewer, and a
// tweet snapshot is already in SWR's cache from the card that rendered it.
//
// Client-side only (`new Image()`); the guard keeps it inert if a server render
// ever reaches it. The React side — the hover timing that calls this — lives in
// components/block-prefetch.ts, so this module stays unit-testable under the
// suite's `--conditions=react-server` (that build of React has no hooks).

import type { Column } from "@/lib/colosseum/column";

// A pointer crossing the grid on its way somewhere else shouldn't pull a
// full-size image for every card it passes over — only a deliberate pause does.
export const PREFETCH_DELAY_MS = 120;

// URLs already requested this page load, so re-hovering a card doesn't allocate
// another Image (the browser would dedupe the request, but this is cheaper).
const requested = new Set<string>();

// Requests in flight. An Image that nothing references can have its load
// cancelled when it's collected, so hold each one until it settles — then drop
// it, since a decoded full-size bitmap is far too big to keep around.
const inFlight = new Set<HTMLImageElement>();

// The URL the modal will load for this block, or null when there's nothing
// worth prefetching. `pdf` blocks reuse `image` for their stored file, so match
// on the type rather than on the field being set.
export function blockMediaUrl(column: Column): string | null {
  return column.type === "image" ? (column.image ?? null) : null;
}

// Fire-and-forget: start fetching this block's full-size media, at most once
// per URL. Failures are ignored — a prefetch that 404s or is refused costs the
// viewer nothing, and the modal will surface the real error if they open it.
export function prefetchBlockMedia(column: Column): void {
  if (typeof window === "undefined") return;

  const url = blockMediaUrl(column);
  if (!url || requested.has(url)) return;

  // Don't spend a metered connection on something that hasn't been opened.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;

  requested.add(url);
  const img = new Image();
  inFlight.add(img);
  const settled = () => inFlight.delete(img);
  img.addEventListener("load", settled, { once: true });
  img.addEventListener("error", settled, { once: true });
  img.src = url;
}
