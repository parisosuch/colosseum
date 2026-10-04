// What's under the pointer, what a marquee selects and what the eraser
// touches. Shapes are tested by their outline, not their box: an unfilled
// rectangle is picked by its border, a pen stroke by its ink, a line by the
// line. Elements clipped by a frame can't be hit outside it, locked elements
// (or anything inside a locked group or frame) can't be hit on the canvas at
// all, and a click picks the outermost group around what it hit.

import type { Point, Rect } from "./camera";
import { CONNECTOR_TYPES, type ElementSnapshot } from "./elements";
import {
  closed,
  containsPoint,
  containsRect,
  diamondCorners,
  ellipsePolygon,
  insideDiamond,
  insideEllipse,
  intersects,
  polylineDistance,
  rectCorners,
  segmentHitsRect,
} from "./geometry";
import type { Geom } from "./layout";
import { inputPoints, strokeSize } from "./pen";

export type HitContext = {
  all: ReadonlyMap<string, ElementSnapshot>;
  // Visible elements in paint order, bottom first (groups included).
  ordered: readonly ElementSnapshot[];
  geom: ReadonlyMap<string, Geom>;
};

// The hit tolerance in screen pixels; callers divide by the zoom.
export const HIT_TOLERANCE = 6;

// A frame's name label sits above its top-left corner at a constant screen
// size. These are its screen-space metrics, shared with the renderer.
export const FRAME_LABEL = { height: 18, gap: 4, charWidth: 7, pad: 4 };

export function frameLabelRect(frame: Rect, name: string, zoom: number): Rect {
  const h = FRAME_LABEL.height / zoom;
  return {
    x: frame.x,
    y: frame.y - (FRAME_LABEL.height + FRAME_LABEL.gap) / zoom,
    w: Math.min(frame.w, (name.length * FRAME_LABEL.charWidth + FRAME_LABEL.pad) / zoom),
    h,
  };
}

export function lockedChain(
  el: ElementSnapshot,
  all: ReadonlyMap<string, ElementSnapshot>,
): boolean {
  let cur: ElementSnapshot | undefined = el;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    if (cur.locked) return true;
    seen.add(cur.id);
    cur = cur.parentId ? all.get(cur.parentId) : undefined;
  }
  return false;
}

function filled(el: ElementSnapshot): boolean {
  return !!el.fill && el.fill !== "none";
}

function outline(el: ElementSnapshot, r: Rect): Point[] {
  if (el.type === "ellipse") return closed(ellipsePolygon(r));
  if (el.type === "diamond") return closed(diamondCorners(r));
  return closed(rectCorners(r));
}

// Whether `p` hits the element's ink. For a frame, "interior" means the point
// is inside the frame but not on its border or label: empty space in it.
function testElement(
  el: ElementSnapshot,
  g: Geom,
  p: Point,
  tol: number,
  zoom: number,
): "hit" | "interior" | null {
  const r = g.rect;
  switch (el.type) {
    case "block":
    case "text":
    case "sticky":
      return containsPoint(r, p) ? "hit" : null;
    case "rect":
    case "ellipse":
    case "diamond": {
      if (filled(el)) {
        const inside =
          el.type === "rect"
            ? containsPoint(r, p)
            : el.type === "ellipse"
              ? insideEllipse(r, p)
              : insideDiamond(r, p);
        if (inside) return "hit";
      }
      return polylineDistance(outline(el, r), p) <= tol + el.width / 2 ? "hit" : null;
    }
    case "stroke": {
      const pts = inputPoints(el.points ?? [], r);
      return polylineDistance(pts, p) <= tol + strokeSize(el.width, el.kind ?? "pen") / 2
        ? "hit"
        : null;
    }
    case "line":
    case "arrow":
      return polylineDistance(g.route ?? [], p) <= tol + el.width / 2 ? "hit" : null;
    case "frame": {
      if (containsPoint(frameLabelRect(r, el.name ?? "Frame", zoom), p)) return "hit";
      if (polylineDistance(closed(rectCorners(r)), p) <= tol) return "hit";
      return containsPoint(r, p) ? "interior" : null;
    }
    case "group":
      return null;
  }
}

// The topmost element under `p`, ignoring groups (the caller maps the result
// to the group to select). Empty space inside a frame stops the search there,
// since the frame's fill covers what's below it.
export function hitLeaf(
  ctx: HitContext,
  p: Point,
  zoom: number,
  opts: {
    includeLocked?: boolean;
    exclude?: ReadonlySet<string>;
    types?: (el: ElementSnapshot) => boolean;
  } = {},
): string | null {
  const tol = HIT_TOLERANCE / zoom;
  for (let i = ctx.ordered.length - 1; i >= 0; i--) {
    const el = ctx.ordered[i];
    if (el.type === "group" || opts.exclude?.has(el.id)) continue;
    if (opts.types && !opts.types(el)) continue;
    const g = ctx.geom.get(el.id);
    if (!g) continue;
    if (g.clip && !containsPoint(g.clip, p)) continue;
    if (!opts.includeLocked && lockedChain(el, ctx.all)) continue;
    const hit = testElement(el, g, p, tol, zoom);
    if (hit === "hit") return el.id;
    if (hit === "interior" && !opts.types) return null;
  }
  return null;
}

// The groups between an element and the nearest frame or the top level,
// outermost first.
export function groupChain(id: string, all: ReadonlyMap<string, ElementSnapshot>): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([id]);
  let parentId = all.get(id)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = all.get(parentId);
    if (!parent || parent.type !== "group") break;
    chain.unshift(parentId);
    parentId = parent.parentId;
  }
  return chain;
}

export function isDescendant(
  id: string,
  ancestor: string,
  all: ReadonlyMap<string, ElementSnapshot>,
): boolean {
  const seen = new Set<string>();
  let cur = all.get(id)?.parentId ?? null;
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = all.get(cur)?.parentId ?? null;
  }
  return false;
}

// What a click on `leaf` selects, Figma's way: the outermost group around it,
// unless the selection is already inside that group (or is the group itself
// and the click is a double-click), in which case the next level down. `deep`
// (cmd+click) goes straight to the element.
export function selectTarget(
  leaf: string,
  all: ReadonlyMap<string, ElementSnapshot>,
  selection: ReadonlySet<string>,
  { deep = false, drill = false }: { deep?: boolean; drill?: boolean } = {},
): string {
  if (deep) return leaf;
  const chain = groupChain(leaf, all);
  let level = 0;
  for (; level < chain.length; level++) {
    const g = chain[level];
    const inside = [...selection].some(
      (s) => (s !== g && isDescendant(s, g, all)) || (drill && s === g),
    );
    if (!inside) break;
  }
  return chain[level] ?? leaf;
}

// The outermost group around an element, or the element: what a marquee picks.
function outermost(id: string, all: ReadonlyMap<string, ElementSnapshot>): string {
  return groupChain(id, all)[0] ?? id;
}

// A marquee selects whatever it touches, as in Figma, with two exceptions: a
// frame only when the marquee covers all of it, and nothing inside something
// else it selected.
export function marqueeSelect(ctx: HitContext, rect: Rect): string[] {
  const picked = new Set<string>();
  for (const el of ctx.ordered) {
    if (el.type === "group" || lockedChain(el, ctx.all)) continue;
    const g = ctx.geom.get(el.id);
    if (!g) continue;
    if (el.type === "frame") {
      if (containsRect(rect, g.rect)) picked.add(el.id);
      continue;
    }
    if (!intersects(g.rect, rect)) continue;
    if (g.clip && !intersects(g.clip, rect)) continue;
    picked.add(outermost(el.id, ctx.all));
  }
  return [...picked].filter(
    (id) => ![...picked].some((other) => other !== id && isDescendant(id, other, ctx.all)),
  );
}

// Elements the eraser's segment a-b passes over. Frames count only by their
// border or label, so erasing inside a frame takes its contents, not it.
export function eraserHits(ctx: HitContext, a: Point, b: Point, zoom: number): string[] {
  const tol = HIT_TOLERANCE / zoom;
  const out: string[] = [];
  for (const el of ctx.ordered) {
    if (el.type === "group" || lockedChain(el, ctx.all)) continue;
    const g = ctx.geom.get(el.id);
    if (!g) continue;
    if (g.clip && !segmentHitsRect(a, b, g.clip)) continue;
    const r = g.rect;
    let hit = false;
    switch (el.type) {
      case "block":
      case "text":
      case "sticky":
        hit = segmentHitsRect(a, b, r);
        break;
      case "rect":
      case "ellipse":
      case "diamond":
        hit =
          polylineDistance(outline(el, r), a, b) <= tol + el.width / 2 ||
          (filled(el) &&
            (el.type === "rect"
              ? segmentHitsRect(a, b, r)
              : el.type === "ellipse"
                ? insideEllipse(r, a) || insideEllipse(r, b)
                : insideDiamond(r, a) || insideDiamond(r, b)));
        break;
      case "stroke":
        hit =
          polylineDistance(inputPoints(el.points ?? [], r), a, b) <=
          tol + strokeSize(el.width, el.kind ?? "pen") / 2;
        break;
      case "line":
      case "arrow":
        hit = polylineDistance(g.route ?? [], a, b) <= tol + el.width / 2;
        break;
      case "frame":
        hit =
          polylineDistance(closed(rectCorners(r)), a, b) <= tol ||
          segmentHitsRect(a, b, frameLabelRect(r, el.name ?? "Frame", zoom));
        break;
    }
    if (hit) out.push(el.id);
  }
  return out;
}

// The topmost element a line end dropped at `p` binds to: anything with a box
// of its own, locked or not, other than the connector itself.
export function bindTarget(ctx: HitContext, p: Point, exclude: ReadonlySet<string>): string | null {
  for (let i = ctx.ordered.length - 1; i >= 0; i--) {
    const el = ctx.ordered[i];
    if (el.type === "group" || CONNECTOR_TYPES.has(el.type) || exclude.has(el.id)) continue;
    const g = ctx.geom.get(el.id);
    if (!g) continue;
    if (g.clip && !containsPoint(g.clip, p)) continue;
    const r = g.rect;
    const inside =
      el.type === "ellipse"
        ? insideEllipse(r, p)
        : el.type === "diamond"
          ? insideDiamond(r, p)
          : containsPoint(r, p);
    if (inside) return el.id;
  }
  return null;
}
