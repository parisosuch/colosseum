// Warms the browser's cache for a block's full-size media while the pointer is
// still resting on its card, so opening the modal paints the image in one go
// instead of streaming it in top-to-bottom. The same warming covers the blocks
// either side of whichever one is open, so stepping with the arrow keys doesn't
// start cold — once the modal is open the pointer is nowhere near the grid.
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

// How far either side of the open block to warm. One step: each arrow press
// turns the block just warmed into the open one, so the radius stays a step
// ahead in both directions for one new request per press. Widening it
// multiplies bandwidth against blocks that get less likely to be reached the
// further out they are, and the arrows move one at a time anyway.
export const NEIGHBOUR_RADIUS = 1;

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

// The viewer has asked for reduced data use. Nothing speculative should go out
// over a metered connection.
export function prefersReducedData(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

// The blocks within `radius` either side of the open one, nearest first, with
// the ends clamped. `index` is -1 when nothing is open, which returns nothing —
// so a modal with no sibling list (the explore feed opens one block at a time)
// falls out here rather than needing its own path.
export function neighbourBlocks(
  columns: Column[],
  index: number,
  radius: number = NEIGHBOUR_RADIUS,
): Column[] {
  if (index < 0) return [];
  const neighbours: Column[] = [];
  for (let step = 1; step <= radius; step++) {
    for (const i of [index - step, index + step]) {
      const column = columns[i];
      if (column) neighbours.push(column);
    }
  }
  return neighbours;
}

// Fire-and-forget: start fetching this block's full-size media, at most once
// per URL. Failures are ignored — a prefetch that 404s or is refused costs the
// viewer nothing, and the modal will surface the real error if they open it.
export function prefetchBlockMedia(column: Column): void {
  if (typeof window === "undefined") return;

  const url = blockMediaUrl(column);
  if (!url || requested.has(url)) return;

  // Don't spend a metered connection on something that hasn't been opened.
  if (prefersReducedData()) return;

  requested.add(url);
  const img = new Image();
  inFlight.add(img);
  const settled = () => inFlight.delete(img);
  img.addEventListener("load", settled, { once: true });
  img.addEventListener("error", settled, { once: true });
  img.src = url;
}
