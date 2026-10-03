// Where every element is in world space, computed once per doc change: boxes
// for blocks and shapes from their stored geometry, routes for lines and
// arrows from their ends (bound ends from the element they're bound to), group
// boxes from their children, and the clip each element gets from the frames
// it sits in.

import type { Point, Rect } from "./camera";
import { route, type EndInput, type OutlineShape } from "./connectors";
import { CONNECTOR_TYPES, childrenByParent, parentOrigin, type ElementSnapshot } from "./elements";
import { boundsOfPoints, intersectRects, unionRects } from "./geometry";

export type Geom = {
  // World box. For a connector, the box of its route; for a group, the union
  // of its children.
  rect: Rect;
  // World position of the element's coordinate space (its parents' x/y).
  origin: Point;
  // Lines and arrows: the route in world space, ends first and last.
  route?: Point[];
  // The intersection of the frames this element is inside, in world space, or
  // null when it isn't in one.
  clip: Rect | null;
};

export type Layout = {
  geom: Map<string, Geom>;
  // Where each connector end is drawn, in the connector's parent space, keyed
  // `${id}:start` and `${id}:end`. Removing an element turns the ends bound to
  // it into free points here.
  ends: Map<string, Point>;
};

export function outlineShape(type: string): OutlineShape {
  return type === "ellipse" ? "ellipse" : type === "diamond" ? "diamond" : "rect";
}

// Elements a line end can bind to: anything with a box of its own.
export function bindable(el: ElementSnapshot): boolean {
  return !CONNECTOR_TYPES.has(el.type) && el.type !== "group";
}

export function computeLayout(all: ReadonlyMap<string, ElementSnapshot>): Layout {
  const geom = new Map<string, Geom>();
  const ends = new Map<string, Point>();
  const origins = new Map<string, Point | null>();
  const originOf = (el: ElementSnapshot) => {
    if (!origins.has(el.id)) origins.set(el.id, parentOrigin(el, all));
    return origins.get(el.id)!;
  };

  // Boxes with geometry of their own.
  for (const el of all.values()) {
    if (CONNECTOR_TYPES.has(el.type) || el.type === "group") continue;
    const o = originOf(el);
    if (!o) continue;
    geom.set(el.id, {
      rect: { x: o.x + el.x, y: o.y + el.y, w: el.w, h: el.h },
      origin: o,
      clip: null,
    });
  }

  // Connectors, from their ends.
  for (const el of all.values()) {
    if (!CONNECTOR_TYPES.has(el.type)) continue;
    const o = originOf(el);
    if (!o) continue;
    const pts = connectorRoute(el, o, all, geom);
    const rect = boundsOfPoints(pts)!;
    geom.set(el.id, { rect, origin: o, route: pts, clip: null });
    ends.set(`${el.id}:start`, { x: pts[0].x - o.x, y: pts[0].y - o.y });
    ends.set(`${el.id}:end`, { x: pts[pts.length - 1].x - o.x, y: pts[pts.length - 1].y - o.y });
  }

  // Groups, from their children, innermost first.
  const children = childrenByParent(all);
  const visiting = new Set<string>();
  const groupRect = (id: string): Rect | null => {
    const known = geom.get(id);
    if (known) return known.rect;
    if (visiting.has(id)) return null;
    visiting.add(id);
    const rects: Rect[] = [];
    for (const c of children.get(id) ?? []) {
      if (c.hidden) continue;
      const r = c.type === "group" ? groupRect(c.id) : (geom.get(c.id)?.rect ?? null);
      if (r) rects.push(r);
    }
    const rect = unionRects(rects);
    const el = all.get(id)!;
    const o = originOf(el);
    if (rect && o) geom.set(id, { rect, origin: o, clip: null });
    return rect;
  };
  for (const el of all.values()) if (el.type === "group") groupRect(el.id);

  // Clips from enclosing frames.
  for (const [id, g] of geom) {
    let clip: Rect | null = null;
    let parentId = all.get(id)?.parentId ?? null;
    const seen = new Set<string>([id]);
    let empty = false;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = all.get(parentId);
      if (!parent) break;
      if (parent.type === "frame") {
        const pr = geom.get(parentId)?.rect;
        if (pr) {
          const next: Rect | null = clip ? intersectRects(clip, pr) : pr;
          if (!next) {
            empty = true;
            break;
          }
          clip = next;
        }
      }
      parentId = parent.parentId;
    }
    g.clip = empty ? { x: g.rect.x, y: g.rect.y, w: 0, h: 0 } : clip;
  }

  return { geom, ends };
}

// A connector's route in world space. `o` is the world origin of its parent;
// `geom` must already hold the boxes of the elements it may be bound to.
export function connectorRoute(
  el: ElementSnapshot,
  o: Point,
  all: ReadonlyMap<string, ElementSnapshot>,
  geom: ReadonlyMap<string, Geom>,
): Point[] {
  const input = (side: "start" | "end"): EndInput => {
    const end = el[side];
    if (end?.kind === "bound") {
      const target = all.get(end.elementId);
      const g = geom.get(end.elementId);
      if (target && g && bindable(target) && end.elementId !== el.id) {
        return {
          kind: "bound",
          rect: g.rect,
          shape: outlineShape(target.type),
          ax: end.ax,
          ay: end.ay,
        };
      }
      return { kind: "point", at: { x: o.x + (end.x ?? el.x), y: o.y + (end.y ?? el.y) } };
    }
    if (end?.kind === "point") return { kind: "point", at: { x: o.x + end.x, y: o.y + end.y } };
    return {
      kind: "point",
      at:
        side === "start"
          ? { x: o.x + el.x, y: o.y + el.y }
          : { x: o.x + el.x + el.w, y: o.y + el.y + el.h },
    };
  };
  return route(input("start"), input("end"), el.routing ?? "straight");
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function samePoints(a: readonly Point[] | undefined, b: readonly Point[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}

// Keep the previous Geom object for every element whose geometry didn't
// change, so memoized renderers skip it.
export function stabilizeLayout(next: Layout, prev: Layout): Layout {
  for (const [id, g] of next.geom) {
    const old = prev.geom.get(id);
    if (
      old &&
      sameRect(old.rect, g.rect) &&
      sameRect(old.clip, g.clip) &&
      old.origin.x === g.origin.x &&
      old.origin.y === g.origin.y &&
      samePoints(old.route, g.route)
    ) {
      next.geom.set(id, old);
    }
  }
  return next;
}
