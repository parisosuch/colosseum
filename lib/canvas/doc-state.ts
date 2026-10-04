// The canvas page's view of the doc, kept up to date one transaction at a
// time. A drag writes one element sixty times a second, and re-reading every
// element, re-sorting paint order and laying out the whole board for each of
// those writes cost 60ms a frame at 5,000 elements. `update` re-reads only
// the elements a transaction touched, and redoes layout, paint order and boxes
// only for what depends on them: the children of a moved frame, the lines bound
// to a moved shape, the groups around any of those. `rebuild` does everything
// from scratch, for the first sync and for transactions that touch most of the
// board; doc-state.test.ts checks the two agree.

import * as Y from "yjs";

import { elementsOf } from "@/lib/realtime/canvas-doc";
import type { Point, Rect } from "./camera";
import {
  CONNECTOR_TYPES,
  effectiveParent,
  parentOrigin,
  readElements,
  sameSnapshot,
  snapshotElement,
  type ElementSnapshot,
} from "./elements";
import { boundsOfPoints, intersectRects, unionRects, type Box } from "./geometry";
import { LayeredMap } from "./layered-map";
import {
  computeLayout,
  connectorRoute,
  sameGeom,
  sameRect,
  stabilizeLayout,
  type Geom,
  type Layout,
} from "./layout";

// What one state changed from the one before it: the ids whose snapshot,
// geometry or box is new or gone, and whether paint order moved (something
// was added, removed, reparented, restacked or hidden). Null when the state
// was rebuilt from scratch.
export type DocChange = { ids: ReadonlySet<string>; order: boolean };

export type DocState = {
  elements: ReadonlyMap<string, ElementSnapshot>;
  // Visible elements in paint order, bottom first, groups included (they draw
  // nothing), and the world boxes of the ones that draw something.
  ordered: readonly ElementSnapshot[];
  boxes: readonly Box[];
  // Every visible element's world box, groups included.
  boxById: ReadonlyMap<string, Box>;
  placed: ReadonlySet<number>;
  layout: Layout;
  // Each parent's children (null for the top level), bottom first, hidden ones
  // included. Only changes when the tree does, so the Layers panel can key off it.
  children: ReadonlyMap<string | null, readonly string[]>;
  // Visible frames in paint order, for their labels.
  frames: readonly ElementSnapshot[];
  changed: DocChange | null;
};

export const EMPTY_DOC: DocState = {
  elements: LayeredMap.empty(),
  ordered: [],
  boxes: [],
  boxById: LayeredMap.empty(),
  placed: new Set(),
  layout: { geom: LayeredMap.empty(), ends: LayeredMap.empty() },
  children: new Map(),
  frames: [],
  changed: null,
};

type All = ReadonlyMap<string, ElementSnapshot>;

// Every map a DocIndex hands out is a LayeredMap; this gets the type back.
function layered<V>(m: ReadonlyMap<string, V>): LayeredMap<string, V> {
  return m instanceof LayeredMap ? m : LayeredMap.from(m);
}

function byZ(all: All) {
  return (a: string, b: string) => {
    const ea = all.get(a)!;
    const eb = all.get(b)!;
    return ea.z < eb.z ? -1 : ea.z > eb.z ? 1 : a < b ? -1 : a > b ? 1 : 0;
  };
}

function insertSorted(list: string[], id: string, cmp: (a: string, b: string) => number) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(list[mid], id) < 0) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, id);
}

function boundIds(el: ElementSnapshot | undefined): string[] {
  if (!el || !CONNECTOR_TYPES.has(el.type)) return [];
  const out: string[] = [];
  if (el.start?.kind === "bound") out.push(el.start.elementId);
  if (el.end?.kind === "bound") out.push(el.end.elementId);
  return out;
}

// Whether a change to an element can move anything on the board: its own box,
// what's inside it, lines bound to it, the group around it, or what's visible.
function geometryChanged(a: ElementSnapshot, b: ElementSnapshot): boolean {
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.w !== b.w ||
    a.h !== b.h ||
    a.parentId !== b.parentId ||
    a.type !== b.type ||
    a.hidden !== b.hidden ||
    a.start !== b.start ||
    a.end !== b.end ||
    a.routing !== b.routing
  );
}

function addTo<K, V>(index: Map<K, Set<V>>, key: K, value: V) {
  let set = index.get(key);
  if (!set) index.set(key, (set = new Set()));
  set.add(value);
}

function removeFrom<K, V>(index: Map<K, Set<V>>, key: K, value: V) {
  const set = index.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) index.delete(key);
}

// The clip an element gets from the frames it sits in, as computeLayout
// works it out.
function clipFor(
  id: string,
  rect: Rect,
  all: All,
  geomOf: (id: string) => Geom | undefined,
): Rect | null {
  let clip: Rect | null = null;
  let parentId = all.get(id)?.parentId ?? null;
  const seen = new Set<string>([id]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = all.get(parentId);
    if (!parent) break;
    if (parent.type === "frame") {
      const pr = geomOf(parentId)?.rect;
      if (pr) {
        const next: Rect | null = clip ? intersectRects(clip, pr) : pr;
        if (!next) return { x: rect.x, y: rect.y, w: 0, h: 0 };
        clip = next;
      }
    }
    parentId = parent.parentId;
  }
  return clip;
}

export class DocIndex {
  state: DocState = EMPTY_DOC;
  // Lookups for the incremental path. They're mutated in place and never
  // leave this class, so nothing outside can see them mid-update.
  private listedUnder = new Map<string, string | null>();
  private rawChildren = new Map<string, Set<string>>();
  private boundTo = new Map<string, Set<string>>();
  // Where each id sits in `ordered` and in `boxes`, built on first use after
  // the list last changed shape: a run of moves reuses one, and a run of
  // creates never builds one.
  private orderIndex: { list: readonly unknown[]; at: Map<string, number> } | null = null;
  private boxIndex: { list: readonly unknown[]; at: Map<string, number> } | null = null;
  private placedCount = new Map<number, number>();

  // Everything from scratch.
  rebuild(doc: Y.Doc): DocState {
    const prev = this.state;
    const all = readElements(doc, prev.elements);
    const elements = LayeredMap.from(all);

    const lists = new Map<string | null, string[]>();
    this.listedUnder.clear();
    this.rawChildren.clear();
    this.boundTo.clear();
    this.placedCount.clear();
    for (const el of all.values()) {
      const parent = effectiveParent(el, all);
      const list = lists.get(parent);
      if (list) list.push(el.id);
      else lists.set(parent, [el.id]);
      this.listedUnder.set(el.id, parent);
      if (el.parentId) addTo(this.rawChildren, el.parentId, el.id);
      for (const target of boundIds(el)) addTo(this.boundTo, target, el.id);
      if (el.columnId != null) {
        this.placedCount.set(el.columnId, (this.placedCount.get(el.columnId) ?? 0) + 1);
      }
    }
    const cmp = byZ(all);
    for (const list of lists.values()) list.sort(cmp);
    const children: ReadonlyMap<string | null, readonly string[]> = lists;

    const { ordered, frames } = paint(children, elements);
    const computed = stabilizeLayout(computeLayout(all), prev.layout);
    const layout = { geom: LayeredMap.from(computed.geom), ends: LayeredMap.from(computed.ends) };
    const boxById = new Map<string, Box>();
    for (const el of ordered) {
      const g = layout.geom.get(el.id);
      if (!g) continue;
      const old = prev.boxById.get(el.id);
      boxById.set(el.id, old && old.rect === g.rect ? old : { id: el.id, rect: g.rect });
    }
    const boxed = LayeredMap.from(boxById);
    this.state = {
      elements,
      ordered,
      boxes: boxList(ordered, boxed),
      boxById: boxed,
      placed: new Set(this.placedCount.keys()),
      layout,
      children,
      frames,
      changed: null,
    };
    return this.state;
  }

  // Apply a transaction that touched `touched` (element ids).
  update(doc: Y.Doc, touched: Iterable<string>): DocState {
    const prev = this.state;
    const yels = elementsOf(doc);

    // --- snapshots ---
    const snaps = new Map<string, ElementSnapshot | undefined>();
    for (const id of touched) {
      const y = yels.get(id);
      const old = prev.elements.get(id);
      const snap = y instanceof Y.Map ? snapshotElement(id, y, old) : null;
      if (snap ? old && sameSnapshot(old, snap) : !old) continue;
      snaps.set(id, snap ?? undefined);
    }
    if (snaps.size === 0) return prev;
    const elements = layered(prev.elements).with(snaps);

    // --- indexes, and what moved in the tree ---
    // `moved`: elements whose parent, stacking or visibility may have changed.
    const moved = new Set<string>();
    let placedChanged = false;
    for (const [id, snap] of snaps) {
      const old = prev.elements.get(id);
      if (
        !old ||
        !snap ||
        old.parentId !== snap.parentId ||
        old.z !== snap.z ||
        old.hidden !== snap.hidden ||
        old.type !== snap.type
      ) {
        moved.add(id);
      }
      if (old?.parentId !== snap?.parentId) {
        if (old?.parentId) removeFrom(this.rawChildren, old.parentId, id);
        if (snap?.parentId) addTo(this.rawChildren, snap.parentId, id);
      }
      if (old?.start !== snap?.start || old?.end !== snap?.end || old?.type !== snap?.type) {
        for (const t of boundIds(old)) removeFrom(this.boundTo, t, id);
        for (const t of boundIds(snap)) addTo(this.boundTo, t, id);
      }
      if (old?.columnId !== snap?.columnId) {
        if (old?.columnId != null) {
          const n = (this.placedCount.get(old.columnId) ?? 1) - 1;
          if (n > 0) this.placedCount.set(old.columnId, n);
          else {
            this.placedCount.delete(old.columnId);
            placedChanged = true;
          }
        }
        if (snap?.columnId != null) {
          const n = this.placedCount.get(snap.columnId) ?? 0;
          this.placedCount.set(snap.columnId, n + 1);
          if (n === 0) placedChanged = true;
        }
      }
    }
    // An element that appears or goes changes where the elements naming it as
    // their parent hang: under it, or at the top level.
    for (const [id, snap] of snaps) {
      if (!prev.elements.has(id) || !snap) {
        for (const c of this.rawChildren.get(id) ?? []) moved.add(c);
      }
    }
    const order = moved.size > 0;

    // --- children ---
    const oldParent = new Map<string, string | null>();
    let children = prev.children;
    if (order) {
      const lists = new Map<string | null, string[]>();
      const edit = (p: string | null) => {
        let l = lists.get(p);
        if (!l) lists.set(p, (l = [...(prev.children.get(p) ?? [])]));
        return l;
      };
      // Out of every list first, so the sorted inserts below never compare
      // against an entry whose z is about to change.
      for (const id of moved) {
        const was = this.listedUnder.get(id);
        if (was === undefined) continue;
        oldParent.set(id, was);
        const l = edit(was);
        const i = l.indexOf(id);
        if (i >= 0) l.splice(i, 1);
        this.listedUnder.delete(id);
      }
      const cmp = byZ(elements);
      for (const id of moved) {
        const el = elements.get(id);
        if (!el) continue;
        const parent = effectiveParent(el, elements);
        insertSorted(edit(parent), id, cmp);
        this.listedUnder.set(id, parent);
      }
      const next = new Map(prev.children);
      for (const [p, l] of lists) {
        if (l.length) next.set(p, l);
        else next.delete(p);
      }
      children = next;
    }

    // --- paint order ---
    let ordered: readonly ElementSnapshot[];
    let frames = prev.frames;
    if (order) {
      ({ ordered, frames } = paint(children, elements));
    } else {
      const at = this.positions("order", prev.ordered);
      const list = prev.ordered.slice();
      for (const [id, snap] of snaps) {
        const i = at.get(id);
        if (i !== undefined && snap) list[i] = snap;
      }
      ordered = list;
      this.orderIndex = { list, at };
      if ([...snaps.keys()].some((id) => prev.elements.get(id)?.type === "frame")) {
        frames = ordered.filter((el) => el.type === "frame");
      }
    }
    // Drawn: not hidden, nor anything it sits in, and hanging off the top
    // level rather than a parent cycle. Unchanged for everything when paint
    // order didn't move.
    const shown = (id: string): boolean => {
      if (!order) return this.positions("order", ordered).has(id);
      let cur: string | null | undefined = id;
      for (let depth = 0; cur; depth++) {
        const el = elements.get(cur);
        if (!el || el.hidden || depth > 64) return false;
        cur = this.listedUnder.get(cur);
        if (cur === undefined) return false;
      }
      return true;
    };

    // --- layout ---
    const prevGeom = prev.layout.geom;
    const geomChanges = new Map<string, Geom | undefined>();
    const geomOf = (id: string) => (geomChanges.has(id) ? geomChanges.get(id) : prevGeom.get(id));
    const geomView = { get: geomOf };

    const dirty = new Set<string>(moved);
    for (const [id, snap] of snaps) {
      const old = prev.elements.get(id);
      if (!old || !snap || geometryChanged(old, snap)) dirty.add(id);
    }
    // Everything inside a container that moved moves with it.
    const stack = [...dirty];
    while (stack.length) {
      const id = stack.pop()!;
      for (const c of children.get(id) ?? []) {
        if (dirty.has(c)) continue;
        dirty.add(c);
        stack.push(c);
      }
    }

    // Boxes with geometry of their own.
    const rectMoved = new Set<string>();
    for (const id of dirty) {
      const el = elements.get(id);
      if (el && (CONNECTOR_TYPES.has(el.type) || el.type === "group")) continue;
      const o = el ? parentOrigin(el, elements) : null;
      const g: Geom | undefined =
        el && o
          ? { rect: { x: o.x + el.x, y: o.y + el.y, w: el.w, h: el.h }, origin: o, clip: null }
          : undefined;
      if (!g && !prevGeom.has(id)) continue;
      geomChanges.set(id, g);
      if (!sameRect(prevGeom.get(id)?.rect, g?.rect)) rectMoved.add(id);
    }

    // Lines and arrows: the ones that changed, and the ones bound to a box
    // that moved, appeared or went.
    const lines = new Set<string>();
    for (const id of dirty) {
      const el = elements.get(id);
      if (el ? CONNECTOR_TYPES.has(el.type) : prevGeom.get(id)?.route) lines.add(id);
    }
    for (const id of rectMoved) for (const c of this.boundTo.get(id) ?? []) lines.add(c);
    for (const id of snaps.keys()) for (const c of this.boundTo.get(id) ?? []) lines.add(c);
    const endChanges = new Map<string, Point | undefined>();
    for (const id of lines) {
      const el = elements.get(id);
      const o = el && CONNECTOR_TYPES.has(el.type) ? parentOrigin(el, elements) : null;
      if (!el || !o) {
        // Gone, no longer a line, or in a parent cycle: no route and no ends.
        if (!(el && !CONNECTOR_TYPES.has(el.type)) && prevGeom.has(id)) {
          geomChanges.set(id, undefined);
        }
        endChanges.set(`${id}:start`, undefined);
        endChanges.set(`${id}:end`, undefined);
        continue;
      }
      const pts = connectorRoute(el, o, elements, geomView);
      geomChanges.set(id, { rect: boundsOfPoints(pts)!, origin: o, route: pts, clip: null });
      endChanges.set(`${id}:start`, { x: pts[0].x - o.x, y: pts[0].y - o.y });
      endChanges.set(`${id}:end`, {
        x: pts[pts.length - 1].x - o.x,
        y: pts[pts.length - 1].y - o.y,
      });
    }

    // Groups around anything that changed, innermost first.
    const groups = new Set<string>();
    const climb = (from: string | null | undefined, all: All) => {
      let id = from ?? null;
      for (let depth = 0; id && depth < 64; depth++) {
        const el = all.get(id);
        if (!el || el.type !== "group") return;
        groups.add(id);
        id = effectiveParent(el, all);
      }
    };
    for (const id of [...dirty, ...lines]) {
      const el = elements.get(id);
      if (el?.type === "group") groups.add(id);
      if (el) climb(effectiveParent(el, elements), elements);
      if (oldParent.has(id)) climb(oldParent.get(id), elements);
      else if (!el) climb(this.listedUnder.get(id), elements);
    }
    const depth = (id: string) => {
      let d = 0;
      for (let p = this.listedUnder.get(id); p && d < 64; p = this.listedUnder.get(p)) d++;
      return d;
    };
    for (const id of [...groups].sort((a, b) => depth(b) - depth(a))) {
      const el = elements.get(id);
      if (!el) continue;
      const rects: Rect[] = [];
      for (const c of children.get(id) ?? []) {
        if (elements.get(c)!.hidden) continue;
        const r = geomOf(c)?.rect;
        if (r) rects.push(r);
      }
      const rect = unionRects(rects);
      const o = parentOrigin(el, elements);
      const g = rect && o ? { rect, origin: o, clip: null } : undefined;
      if (!g && !prevGeom.has(id)) continue;
      geomChanges.set(id, g);
    }

    // Clips, from the final frame boxes, then keep every Geom that came out
    // the same as before.
    for (const [id, g] of geomChanges) {
      if (!g) continue;
      g.clip = clipFor(id, g.rect, elements, geomOf);
    }
    for (const [id, g] of geomChanges) {
      const old = prevGeom.get(id);
      if (g && old && sameGeom(old, g)) geomChanges.delete(id);
    }
    const ends = prev.layout.ends;
    for (const [key, p] of endChanges) {
      const old = ends.get(key);
      if (p && old && p.x === old.x && p.y === old.y) endChanges.delete(key);
    }
    const layout: Layout =
      geomChanges.size || endChanges.size
        ? { geom: layered(prevGeom).with(geomChanges), ends: layered(ends).with(endChanges) }
        : prev.layout;

    // --- boxes ---
    const boxChanges = new Map<string, Box | undefined>();
    for (const id of new Set([...geomChanges.keys(), ...dirty])) {
      const g = layout.geom.get(id);
      const old = prev.boxById.get(id);
      const box =
        g && shown(id) ? (old && old.rect === g.rect ? old : { id, rect: g.rect }) : undefined;
      if (box !== old) boxChanges.set(id, box);
    }
    const boxById = boxChanges.size ? layered(prev.boxById).with(boxChanges) : prev.boxById;
    let boxes: readonly Box[];
    const boxAt = order ? null : this.positions("box", prev.boxes);
    if (!boxAt || [...boxChanges].some(([id, b]) => !b || !boxAt.has(id))) {
      boxes = boxList(ordered, boxById);
    } else if (boxChanges.size) {
      const list = prev.boxes.slice();
      for (const [id, b] of boxChanges) list[boxAt.get(id)!] = b!;
      boxes = list;
      this.boxIndex = { list, at: boxAt };
    } else {
      boxes = prev.boxes;
    }

    const ids = new Set<string>(snaps.keys());
    for (const id of geomChanges.keys()) ids.add(id);
    for (const id of boxChanges.keys()) ids.add(id);

    this.state = {
      elements,
      ordered,
      boxes,
      boxById,
      placed: placedChanged ? new Set(this.placedCount.keys()) : prev.placed,
      layout,
      children,
      frames,
      changed: { ids, order },
    };
    return this.state;
  }

  private positions(which: "order" | "box", list: readonly { id: string }[]): Map<string, number> {
    const known = which === "order" ? this.orderIndex : this.boxIndex;
    if (known && known.list === list) return known.at;
    const at = new Map<string, number>();
    list.forEach((item, i) => at.set(item.id, i));
    if (which === "order") this.orderIndex = { list, at };
    else this.boxIndex = { list, at };
    return at;
  }
}

// Paint order: siblings bottom first, children right after their parent,
// nothing under a hidden element. Each id sits in exactly one child list, so
// the walk needs no visited set; an element in a parent cycle is in no list
// reachable from the top and isn't drawn, as in paintOrder. Visible frames
// come out too, for their labels.
function paint(children: ReadonlyMap<string | null, readonly string[]>, all: All) {
  const ordered: ElementSnapshot[] = [];
  const frames: ElementSnapshot[] = [];
  const walk = (parent: string | null) => {
    for (const id of children.get(parent) ?? []) {
      const el = all.get(id)!;
      if (el.hidden) continue;
      ordered.push(el);
      if (el.type === "frame") frames.push(el);
      if (children.has(id)) walk(id);
    }
  };
  walk(null);
  return { ordered, frames };
}

function boxList(ordered: readonly ElementSnapshot[], boxById: ReadonlyMap<string, Box>) {
  const boxes: Box[] = [];
  for (const el of ordered) {
    if (el.type === "group") continue;
    const b = boxById.get(el.id);
    if (b) boxes.push(b);
  }
  return boxes;
}
