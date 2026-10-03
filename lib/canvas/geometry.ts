// Hit-testing, marquee selection, culling, the click/drag threshold and resize
// math for the canvas. Pure functions over world-space rectangles, so the
// pointer handlers stay thin and all of this is testable without a DOM.

import type { Point, Rect } from "./camera";

// How far the pointer travels before a press on a block becomes a move, or a
// press on empty space becomes a marquee. Below it a release is a click.
export const DRAG_THRESHOLD = 3;

export type Box = { id: string; rect: Rect };

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

// Touching counts: a marquee that reaches an element's edge selects it, as in
// Figma.
export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function unionRects(rects: Iterable<Rect>): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// The topmost box under `p`. `boxes` is in paint order, bottom first, which is
// the order the world layer renders them in; the last hit wins.
export function hitTest(boxes: readonly Box[], p: Point): string | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    if (containsPoint(boxes[i].rect, p)) return boxes[i].id;
  }
  return null;
}

// Every box the marquee touches.
export function marqueeHits(boxes: readonly Box[], marquee: Rect): string[] {
  return boxes.filter((b) => intersects(b.rect, marquee)).map((b) => b.id);
}

// The boxes worth rendering: those inside the visible world rect grown by
// `margin` (world units). Everything else is skipped, so a canvas holding
// thousands of blocks only pays for what's near the screen.
export function cullBoxes(boxes: readonly Box[], view: Rect, margin: number): Set<string> {
  const area = expandRect(view, margin);
  const ids = new Set<string>();
  for (const b of boxes) if (intersects(b.rect, area)) ids.add(b.id);
  return ids;
}

// Whether the culled set needs recomputing. The set was computed for
// `culledFor` (the view plus its margin). While the view stays inside that
// area, minus a fraction of the margin as headroom, nothing new can be on
// screen, so a pan re-renders nothing until it nears the edge.
export function needsRecull(culledFor: Rect | null, view: Rect, headroom: number): boolean {
  if (!culledFor) return true;
  return !containsRect(expandRect(culledFor, -headroom), view);
}

export function pastThreshold(start: Point, current: Point, threshold = DRAG_THRESHOLD): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold;
}

export type Handle = "nw" | "ne" | "sw" | "se";

export const HANDLES: readonly Handle[] = ["nw", "ne", "sw", "se"];

export function handlePoint(r: Rect, h: Handle): Point {
  return {
    x: h === "nw" || h === "sw" ? r.x : r.x + r.w,
    y: h === "nw" || h === "ne" ? r.y : r.y + r.h,
  };
}

// The handle within `radius` of `p`, if any. Called with screen-space rects so
// the target stays the same size at every zoom.
export function hitHandle(r: Rect, p: Point, radius: number): Handle | null {
  for (const h of HANDLES) {
    const hp = handlePoint(r, h);
    if (Math.abs(p.x - hp.x) <= radius && Math.abs(p.y - hp.y) <= radius) return h;
  }
  return null;
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

// Drag handle `h` of `start` by (dx, dy). The opposite corner stays put. With
// `keepAspect` the box keeps its proportions, following whichever axis moved
// further. The result is never smaller than `min` on either side, and a drag
// past the opposite corner stops there rather than flipping the box.
export function resizeRect(
  start: Rect,
  h: Handle,
  dx: number,
  dy: number,
  {
    keepAspect = false,
    min = { w: 1, h: 1 },
  }: { keepAspect?: boolean; min?: { w: number; h: number } } = {},
): Rect {
  const west = h === "nw" || h === "sw";
  const north = h === "nw" || h === "ne";
  let w = start.w + (west ? -dx : dx);
  let hh = start.h + (north ? -dy : dy);
  if (keepAspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (Math.abs(w / start.w) > Math.abs(hh / start.h)) hh = w / ratio;
    else w = hh * ratio;
    // Respect the minimum on both axes without breaking the ratio.
    const scale = Math.max(1, min.w / Math.max(w, 1e-9), min.h / Math.max(hh, 1e-9));
    w *= scale;
    hh *= scale;
  }
  w = Math.max(min.w, w);
  hh = Math.max(min.h, hh);
  return {
    x: west ? start.x + start.w - w : start.x,
    y: north ? start.y + start.h - hh : start.y,
    w,
    h: hh,
  };
}

// Map each rect from the `from` box into the `to` box, scaling position and
// size together, which is how resizing a multi-selection by its bounding box
// works.
export function scaleRects(rects: readonly Rect[], from: Rect, to: Rect): Rect[] {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  return rects.map((r) => ({
    x: to.x + (r.x - from.x) * sx,
    y: to.y + (r.y - from.y) * sy,
    w: r.w * sx,
    h: r.h * sy,
  }));
}

// Arrow-key nudges: 1px, or 10px with shift, in world units.
export function nudgeDelta(key: string, shift: boolean): Point | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return null;
  }
}
