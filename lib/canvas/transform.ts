// Moving and resizing elements of every type, and align and distribute.
//
// A move translates the selected elements (and so everything inside them).
// A line's free ends move with it; an end bound to an element that isn't
// moving comes loose where it is, as in Excalidraw. A resize maps each selected
// element's box from the selection's old bounds to its new ones: shapes and
// cards take the new box, pen strokes scale their points, lines scale their
// free ends, groups scale their children, and frames keep their children where
// they are on screen.

import type { Point, Rect } from "./camera";
import {
  BLOCK_MIN_SIZE,
  CONNECTOR_TYPES,
  childrenByParent,
  effectiveParent,
  parentOrigin,
  withDescendants,
  type ElementSnapshot,
} from "./elements";
import { unionRects } from "./geometry";
import type { Layout } from "./layout";
import { scalePoints } from "./pen";
import { topmostOnly } from "./tree";

type All = ReadonlyMap<string, ElementSnapshot>;
export type PropsUpdate = { id: string; props: Record<string, unknown> };

const round = Math.round;

// Translate `el` (a snapshot from when the gesture started) by (dx, dy).
// `moving` is everything moving with it, descendants included, so a binding
// between two moving elements survives.
export function translated(
  el: ElementSnapshot,
  dx: number,
  dy: number,
  moving: ReadonlySet<string>,
  layout: Layout,
): Record<string, unknown> {
  const props: Record<string, unknown> = { x: round(el.x + dx), y: round(el.y + dy) };
  if (CONNECTOR_TYPES.has(el.type)) {
    for (const side of ["start", "end"] as const) {
      const end = el[side];
      if (!end) continue;
      if (end.kind === "point") {
        props[side] = { kind: "point", x: round(end.x + dx), y: round(end.y + dy) };
      } else if (!moving.has(end.elementId)) {
        const at = layout.ends.get(`${el.id}:${side}`) ?? { x: end.x ?? el.x, y: end.y ?? el.y };
        props[side] = { kind: "point", x: round(at.x + dx), y: round(at.y + dy) };
      }
    }
  }
  return props;
}

// The writes for moving `ids` by (dx, dy) from their `start` snapshots.
// `moving` is everything that moves (withDescendants of the roots), which a
// drag works out once instead of on every frame.
export function moveUpdates(
  start: All,
  ids: Iterable<string>,
  dx: number,
  dy: number,
  layout: Layout,
  moving?: ReadonlySet<string>,
): PropsUpdate[] {
  const roots = topmostOnly(ids, start);
  moving ??= withDescendants(roots, start);
  return roots
    .filter((id) => !start.get(id)!.locked)
    .map((id) => ({ id, props: translated(start.get(id)!, dx, dy, moving, layout) }));
}

// After a gesture, write each connector's route box (and where its bound ends
// were drawn) back to its stored fields, so the server and anyone reading the
// doc without resolving bindings sees roughly where it is.
export function connectorBoxUpdates(all: All, layout: Layout): PropsUpdate[] {
  const out: PropsUpdate[] = [];
  for (const el of all.values()) {
    if (!CONNECTOR_TYPES.has(el.type)) continue;
    const g = layout.geom.get(el.id);
    if (!g) continue;
    const props: Record<string, unknown> = {
      x: round(g.rect.x - g.origin.x),
      y: round(g.rect.y - g.origin.y),
      w: round(g.rect.w),
      h: round(g.rect.h),
    };
    for (const side of ["start", "end"] as const) {
      const end = el[side];
      const at = layout.ends.get(`${el.id}:${side}`);
      if (end?.kind === "bound" && at && (end.x !== round(at.x) || end.y !== round(at.y))) {
        props[side] = { ...end, x: round(at.x), y: round(at.y) };
      }
    }
    if (
      props.x !== el.x ||
      props.y !== el.y ||
      props.w !== el.w ||
      props.h !== el.h ||
      props.start ||
      props.end
    ) {
      out.push({ id: el.id, props });
    }
  }
  return out;
}

// --- resize ---

type Map2D = (p: Point) => Point;

function mapper(from: Rect, to: Rect): { map: Map2D; sx: number; sy: number } {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  return {
    sx,
    sy,
    map: (p) => ({ x: to.x + (p.x - from.x) * sx, y: to.y + (p.y - from.y) * sy }),
  };
}

// The world origin of an element's own coordinate space: where its children's
// x/y are measured from.
function ownOrigin(el: ElementSnapshot, all: All): Point | null {
  const o = parentOrigin(el, all);
  return o ? { x: o.x + el.x, y: o.y + el.y } : null;
}

// Resize the selection `ids` from bounds `from` to bounds `to` (world). `start`
// is the doc at the start of the gesture, and `childIds` its child lists if the
// caller keeps them (DocState.children).
export function resizeUpdates(
  start: All,
  ids: Iterable<string>,
  layout: Layout,
  from: Rect,
  to: Rect,
  childIds?: ReadonlyMap<string | null, readonly string[]>,
): PropsUpdate[] {
  const roots = topmostOnly(ids, start).filter((id) => !start.get(id)!.locked);
  const { map, sx, sy } = mapper(from, to);
  // Only groups and frames need their children, so the whole doc is sorted
  // into lists only when one is being resized and no lists came in.
  let sorted: Map<string | null, ElementSnapshot[]> | null = null;
  const children = {
    get: (id: string): readonly ElementSnapshot[] | undefined =>
      childIds
        ? childIds.get(id)?.map((c) => start.get(c)!)
        : (sorted ??= childrenByParent(start)).get(id),
  };

  // Groups scale what's in them; frames don't.
  const set = new Set<string>();
  const add = (id: string) => {
    set.add(id);
    const el = start.get(id)!;
    if (el.type === "group") for (const c of children.get(id) ?? []) add(c.id);
  };
  for (const id of roots) add(id);

  const newOrigin = new Map<string, Point>();
  const originAfter = (id: string | null): Point => {
    if (!id) return { x: 0, y: 0 };
    const known = newOrigin.get(id);
    if (known) return known;
    const el = start.get(id);
    return (el && ownOrigin(el, start)) ?? { x: 0, y: 0 };
  };
  for (const id of set) {
    const el = start.get(id)!;
    const o = ownOrigin(el, start);
    if (o) newOrigin.set(id, map(o));
  }

  const out: PropsUpdate[] = [];
  for (const id of set) {
    const el = start.get(id)!;
    const o = ownOrigin(el, start);
    if (!o) continue;
    const parentId = effectiveParent(el, start);
    const p = originAfter(parentId);
    const mine = newOrigin.get(id)!;
    const props: Record<string, unknown> = { x: round(mine.x - p.x), y: round(mine.y - p.y) };
    if (el.type === "group") {
      // Its box is its children's; only its origin moves.
    } else if (CONNECTOR_TYPES.has(el.type)) {
      const oldParent = parentOrigin(el, start) ?? { x: 0, y: 0 };
      for (const side of ["start", "end"] as const) {
        const end = el[side];
        if (end?.kind !== "point") continue;
        const w = map({ x: oldParent.x + end.x, y: oldParent.y + end.y });
        props[side] = { kind: "point", x: round(w.x - p.x), y: round(w.y - p.y) };
      }
      props.w = round(el.w * sx);
      props.h = round(el.h * sy);
    } else {
      let w = el.w * sx;
      let h = el.h * sy;
      if (el.type === "block") {
        w = Math.max(BLOCK_MIN_SIZE.w, w);
        h = Math.max(BLOCK_MIN_SIZE.h, h);
      }
      props.w = round(Math.max(1, w));
      props.h = round(Math.max(1, h));
      if (el.type === "stroke" && el.points) {
        props.points = scalePoints(el.points, el, { w: props.w as number, h: props.h as number });
      }
      if (el.type === "text") props.autoSize = false;
    }
    out.push({ id, props });

    // A resized frame's children stay where they are on screen.
    if (el.type === "frame") {
      for (const c of children.get(id) ?? []) {
        if (set.has(c.id)) continue;
        const co = ownOrigin(c, start);
        if (!co) continue;
        out.push({ id: c.id, props: { x: round(co.x - mine.x), y: round(co.y - mine.y) } });
      }
    }
  }
  return out;
}

// --- align and distribute ---

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

// Align the selection to its own bounds, or a single element to the frame it's
// in, as in Figma. Locked elements stay put and don't count.
export function alignUpdates(
  all: All,
  ids: Iterable<string>,
  layout: Layout,
  mode: AlignMode,
): PropsUpdate[] {
  const roots = topmostOnly(ids, all).filter((id) => !all.get(id)!.locked);
  const rects = new Map<string, Rect>();
  for (const id of roots) {
    const r = layout.geom.get(id)?.rect;
    if (r) rects.set(id, r);
  }
  let target: Rect | null = null;
  if (rects.size === 1) {
    const [id] = rects.keys();
    const parent = effectiveParent(all.get(id)!, all);
    if (parent && all.get(parent)?.type === "frame") target = layout.geom.get(parent)?.rect ?? null;
  } else {
    target = unionRects(rects.values());
  }
  if (!target) return [];
  const moving = withDescendants(rects.keys(), all);
  const out: PropsUpdate[] = [];
  for (const [id, r] of rects) {
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = target.x - r.x;
    if (mode === "right") dx = target.x + target.w - (r.x + r.w);
    if (mode === "hcenter") dx = target.x + target.w / 2 - (r.x + r.w / 2);
    if (mode === "top") dy = target.y - r.y;
    if (mode === "bottom") dy = target.y + target.h - (r.y + r.h);
    if (mode === "vcenter") dy = target.y + target.h / 2 - (r.y + r.h / 2);
    if (Math.round(dx) === 0 && Math.round(dy) === 0) continue;
    out.push({ id, props: translated(all.get(id)!, dx, dy, moving, layout) });
  }
  return out;
}

// Equal gaps between three or more elements, the outermost two staying put.
export function distributeUpdates(
  all: All,
  ids: Iterable<string>,
  layout: Layout,
  axis: "x" | "y",
): PropsUpdate[] {
  const items = topmostOnly(ids, all)
    .filter((id) => !all.get(id)!.locked)
    .map((id) => ({ id, r: layout.geom.get(id)?.rect }))
    .filter((i): i is { id: string; r: Rect } => !!i.r);
  if (items.length < 3) return [];
  const lo = (r: Rect) => (axis === "x" ? r.x : r.y);
  const len = (r: Rect) => (axis === "x" ? r.w : r.h);
  items.sort((a, b) => lo(a.r) + len(a.r) / 2 - (lo(b.r) + len(b.r) / 2));
  const first = items[0].r;
  const last = items[items.length - 1].r;
  const span = lo(last) + len(last) - lo(first);
  const total = items.reduce((s, i) => s + len(i.r), 0);
  const gap = (span - total) / (items.length - 1);
  const moving = withDescendants(
    items.map((i) => i.id),
    all,
  );
  const out: PropsUpdate[] = [];
  let at = lo(first);
  for (const { id, r } of items) {
    const d = at - lo(r);
    at += len(r) + gap;
    if (Math.round(d) === 0) continue;
    out.push({
      id,
      props: translated(all.get(id)!, axis === "x" ? d : 0, axis === "y" ? d : 0, moving, layout),
    });
  }
  return out;
}
