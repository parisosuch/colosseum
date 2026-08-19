// Warms the browser's cache for a block's full-size media while the pointer is
// still resting on its card, so opening the modal paints the image in one go
// instead of streaming it in top-to-bottom. The same warming covers the blocks
// either side of whichever one is open, so stepping with the arrow keys doesn't
// start cold — once the modal is open the pointer is nowhere near the grid.
//
// Three kinds of block are worth warming:
//
// - `image`, whose grid card shows a downsized `?thumb`, so the modal's
//   full-size fetch always starts cold — that's the visible top-to-bottom
//   render.
// - `url`, whose modal shows the same cached screenshot as the card. Usually
//   already warm, but not when the card is scrolled out of the grid or its
//   capture landed after the card painted.
// - `youtube` / `spotify`, whose embed is a third-party iframe that can't be
//   fetched ahead — but DNS + TCP + TLS to the embed host is most of the delay
//   before it draws, and a `preconnect` hint warms exactly that.
//
// The other types have nothing to gain: a video streams as it plays, a PDF
// renders progressively inside its own viewer, a tweet snapshot is already in
// SWR's cache from the card that rendered it, and text/channel blocks carry
// their content in the block row.
//
// Client-side only (`new Image()`, `document.head`); the guards keep it inert
// if a server render ever reaches it. The React side — the hover timing that
// calls this — lives in components/block-prefetch.ts, so this module stays
// unit-testable under the suite's `--conditions=react-server` (that build of
// React has no hooks).

import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { screenshotSrc } from "@/lib/utils";

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

// Third-party origins each embed type connects to as soon as its iframe
// mounts. YouTube's player pulls its poster frame from i.ytimg.com, which is a
// separate connection from the embed document's.
const EMBED_ORIGINS: Partial<Record<Column["type"], readonly string[]>> = {
  youtube: ["https://www.youtube.com", "https://i.ytimg.com"],
  spotify: ["https://open.spotify.com"],
};

// Origins already hinted this page load. Stepping along a row of YouTube blocks
// should append one <link> per origin, not one per block.
const preconnected = new Set<string>();

// The URL the modal will load for this block, or null when there's nothing
// worth prefetching. `pdf` blocks reuse `image` for their stored file, so match
// on the type rather than on the field being set. A `url` block's screenshot is
// whatever the board's batched map holds for it; the `?v=` token comes from the
// shared helper, so the warmed entry is the one the renderer asks for.
export function blockMediaUrl(column: Column, screenshot?: ColumnScreenshot | null): string | null {
  if (column.type === "image") return column.image ?? null;
  if (column.type === "url") return screenshotSrc(screenshot?.image_url, screenshot?.captured_at);
  return null;
}

// The origins worth a preconnect hint before this block's modal opens, or an
// empty list for everything that isn't a third-party embed.
export function blockPreconnectOrigins(column: Column): readonly string[] {
  return EMBED_ORIGINS[column.type] ?? [];
}

// Records `origin` as hinted and reports whether this is the call that has to
// append the <link>. Every later call for the same origin gets false back.
export function claimPreconnect(origin: string): boolean {
  if (preconnected.has(origin)) return false;
  preconnected.add(origin);
  return true;
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
export function prefetchBlockMedia(column: Column, screenshot?: ColumnScreenshot | null): void {
  if (typeof window === "undefined") return;

  const url = blockMediaUrl(column, screenshot);
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

// Open the connections this block's embed will need, so the iframe spends its
// first moments transferring rather than shaking hands. No `crossOrigin`: the
// embed document and the poster <img> both use the browser's non-CORS
// connection pool, and setting it would warm the other one.
export function preconnectBlockOrigins(column: Column): void {
  if (typeof document === "undefined") return;

  const origins = blockPreconnectOrigins(column);
  if (origins.length === 0) return;

  // A handshake still costs radio time on a metered connection.
  if (prefersReducedData()) return;

  for (const origin of origins) {
    if (!claimPreconnect(origin)) continue;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    document.head.appendChild(link);
  }
}
