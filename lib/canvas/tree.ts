// The element tree: moving elements between parents (frames, groups, the top
// level) without moving them on screen, grouping and ungrouping, layer order,
// and the Layers panel's rows.
//
// An element's x/y (and a connector's free ends) are relative to its parent,
// so changing parents rewrites them by the difference between the two
// parents' world origins. Z keys are fractional (lib/fractional-index.ts), so a
// reorder rewrites only the elements that moved.

import * as Y from "yjs";

import { elementsOf } from "@/lib/realtime/canvas-doc";
import type { Point, Rect } from "./camera";
import {
  CONNECTOR_TYPES,
  childrenByParent,
  effectiveParent,
  elementMap,
  newElementId,
  paintOrder,
  parentOrigin,
  readElements,
  removeEmptyGroups,
  withDescendants,
  zBetween,
  type ElementSnapshot,
} from "./elements";
import { containsPoint, unionRects } from "./geometry";
import { isDescendant } from "./hit";
import type { Layout } from "./layout";

type All = ReadonlyMap<string, ElementSnapshot>;

// The fields to write so `el` keeps its world position under a parent whose
// world origin is `to` instead of `from`.
function shiftedFields(el: ElementSnapshot, from: Point, to: Point): Record<string, unknown> {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const props: Record<string, unknown> = { x: Math.round(el.x + dx), y: Math.round(el.y + dy) };
  if (CONNECTOR_TYPES.has(el.type)) {
    for (const side of ["start", "end"] as const) {
      const end = el[side];
      if (!end) continue;
      if (end.kind === "point")
        props[side] = { ...end, x: Math.round(end.x + dx), y: Math.round(end.y + dy) };
      else if (end.x !== undefined && end.y !== undefined) {
        props[side] = { ...end, x: Math.round(end.x + dx), y: Math.round(end.y + dy) };
      }
    }
  }
  return props;
}

function writeFields(elements: Y.Map<Y.Map<unknown>>, id: string, props: Record<string, unknown>) {
  const m = elements.get(id);
  if (!m) return;
  for (const [k, v] of Object.entries(props)) if (m.get(k) !== v) m.set(k, v);
}

// `n` ascending keys strictly between a and b (either may be null).
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  const out: string[] = [];
  let prev = a;
  for (let i = 0; i < n; i++) {
    prev = zBetween(prev, b);
    out.push(prev);
  }
  return out;
}

// Drop the ids that sit inside another id in the list: moving a frame moves
// what's in it.
export function topmostOnly(ids: Iterable<string>, all: All): string[] {
  const set = new Set(ids);
  return [...set].filter(
    (id) => all.has(id) && ![...set].some((o) => o !== id && isDescendant(id, o, all)),
  );
}

function sortByPaint(ids: readonly string[], all: All): string[] {
  const order = new Map(paintOrder(all).map((e, i) => [e.id, i]));
  // Hidden elements aren't painted; keep them in z order among themselves.
  return [...ids].sort(
    (a, b) =>
      (order.get(a) ?? -1) - (order.get(b) ?? -1) || (all.get(a)!.z < all.get(b)!.z ? -1 : 1),
  );
}

// Move elements into `parentId` (null for the top level), keeping them where
// they are on screen. `ref` places them just above or below a sibling there;
// without it they go on top. Moves that would put an element inside itself are
// skipped.
export function moveTo(
  doc: Y.Doc,
  ids: Iterable<string>,
  parentId: string | null,
  origin: unknown,
  ref: { id: string; where: "above" | "below" } | null = null,
): void {
  const all = readElements(doc);
  const elements = elementsOf(doc);
  if (parentId && !all.has(parentId)) return;
  const moving = sortByPaint(
    topmostOnly(ids, all).filter(
      (id) => id !== parentId && !(parentId && isDescendant(parentId, id, all)),
    ),
    all,
  );
  if (moving.length === 0) return;
  const target = parentId ? { id: parentId, parentId: all.get(parentId)!.parentId } : null;
  const to = target ? (parentOrigin(target, all) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
  if (target) {
    const p = all.get(parentId!)!;
    to.x += p.x;
    to.y += p.y;
  }
  const siblings = (childrenByParent(all).get(parentId) ?? []).filter(
    (s) => !moving.includes(s.id),
  );
  let lo: string | null;
  let hi: string | null;
  const refIdx = ref ? siblings.findIndex((s) => s.id === ref.id) : -1;
  if (refIdx >= 0) {
    if (ref!.where === "above") {
      lo = siblings[refIdx].z;
      hi = siblings[refIdx + 1]?.z ?? null;
    } else {
      lo = siblings[refIdx - 1]?.z ?? null;
      hi = siblings[refIdx].z;
    }
  } else {
    lo = siblings.length ? siblings[siblings.length - 1].z : null;
    hi = null;
  }
  const keys = keysBetween(lo, hi, moving.length);
  doc.transact(() => {
    moving.forEach((id, i) => {
      const el = all.get(id)!;
      const from = parentOrigin(el, all) ?? { x: 0, y: 0 };
      const props = effectiveParent(el, all) === parentId ? {} : shiftedFields(el, from, to);
      writeFields(elements, id, { ...props, parentId, z: keys[i] });
    });
    removeEmptyGroups(elements, all, new Set(moving));
  }, origin);
}

// Group the selection. The group goes where the topmost selected element was,
// and its children keep their order and their place on screen. Returns the
// group's id, or null when there's nothing to group.
export function groupElements(
  doc: Y.Doc,
  ids: Iterable<string>,
  layout: Layout,
  createdBy: string,
  origin: unknown,
): string | null {
  const all = readElements(doc);
  const members = sortByPaint(topmostOnly(ids, all), all);
  if (members.length === 0) return null;
  const top = all.get(members[members.length - 1])!;
  const parentId = effectiveParent(top, all);
  const rects = members.map((id) => layout.geom.get(id)?.rect).filter((r): r is Rect => !!r);
  const bounds = unionRects(rects);
  if (!bounds) return null;
  const parentWorld = parentId
    ? (() => {
        const p = all.get(parentId)!;
        const o = parentOrigin(p, all) ?? { x: 0, y: 0 };
        return { x: o.x + p.x, y: o.y + p.y };
      })()
    : { x: 0, y: 0 };
  const gx = Math.round(bounds.x - parentWorld.x);
  const gy = Math.round(bounds.y - parentWorld.y);
  const groupWorld = { x: parentWorld.x + gx, y: parentWorld.y + gy };
  const id = newElementId();
  const elements = elementsOf(doc);
  const keys = keysBetween(null, null, members.length);
  doc.transact(() => {
    // The top member leaves its slot for the group, so the group takes its key.
    const groupZ = top.z;
    elements.set(
      id,
      elementMap(
        {
          type: "group",
          x: gx,
          y: gy,
          w: Math.round(bounds.w),
          h: Math.round(bounds.h),
          parentId,
          z: groupZ,
          createdBy,
        },
        all,
      ),
    );
    members.forEach((mid, i) => {
      const el = all.get(mid)!;
      const from = parentOrigin(el, all) ?? { x: 0, y: 0 };
      writeFields(elements, mid, {
        ...shiftedFields(el, from, groupWorld),
        parentId: id,
        z: keys[i],
      });
    });
    removeEmptyGroups(elements, all, new Set(members));
  }, origin);
  return id;
}

// Ungroup: the children move to the group's parent, in the group's place in
// the stack, and the group goes. Returns the children, for the new selection.
export function ungroupElements(doc: Y.Doc, ids: Iterable<string>, origin: unknown): string[] {
  const all = readElements(doc);
  const elements = elementsOf(doc);
  const groups = [...ids]
    .map((id) => all.get(id))
    .filter((g): g is ElementSnapshot => g?.type === "group");
  if (groups.length === 0) return [];
  const byParent = childrenByParent(all);
  const freed: string[] = [];
  doc.transact(() => {
    for (const g of groups) {
      const parentId = effectiveParent(g, all);
      const siblings = byParent.get(parentId) ?? [];
      const idx = siblings.findIndex((s) => s.id === g.id);
      const above = siblings[idx + 1]?.z ?? null;
      const kids = byParent.get(g.id) ?? [];
      const keys = keysBetween(siblings[idx - 1]?.z ?? null, above, kids.length);
      const groupWorld = (() => {
        const o = parentOrigin(g, all) ?? { x: 0, y: 0 };
        return { x: o.x + g.x, y: o.y + g.y };
      })();
      const parentWorld = parentOrigin(g, all) ?? { x: 0, y: 0 };
      kids.forEach((k, i) => {
        writeFields(elements, k.id, {
          ...shiftedFields(k, groupWorld, parentWorld),
          parentId,
          z: keys[i],
        });
        freed.push(k.id);
      });
      elements.delete(g.id);
    }
  }, origin);
  return freed;
}

export type ZOp = "forward" | "backward" | "front" | "back";

// Bring forward, send backward, bring to front, send to back, among each
// element's siblings. Only the elements that move get new keys.
export function reorder(doc: Y.Doc, ids: Iterable<string>, op: ZOp, origin: unknown): void {
  const all = readElements(doc);
  const elements = elementsOf(doc);
  const chosen = new Set(topmostOnly(ids, all));
  const byParent = childrenByParent(all);
  const writes: { id: string; z: string }[] = [];
  for (const [, siblings] of byParent) {
    if (!siblings.some((s) => chosen.has(s.id))) continue;
    let order = siblings.map((s) => s.id);
    if (op === "front")
      order = [...order.filter((id) => !chosen.has(id)), ...order.filter((id) => chosen.has(id))];
    else if (op === "back")
      order = [...order.filter((id) => chosen.has(id)), ...order.filter((id) => !chosen.has(id))];
    else if (op === "forward") {
      for (let i = order.length - 2; i >= 0; i--) {
        if (chosen.has(order[i]) && !chosen.has(order[i + 1]))
          [order[i], order[i + 1]] = [order[i + 1], order[i]];
      }
    } else {
      for (let i = 1; i < order.length; i++) {
        if (chosen.has(order[i]) && !chosen.has(order[i - 1]))
          [order[i], order[i - 1]] = [order[i - 1], order[i]];
      }
    }
    // Give each run of chosen elements keys between its unchosen neighbours,
    // which keep theirs.
    const z = new Map(siblings.map((s) => [s.id, s.z]));
    let i = 0;
    while (i < order.length) {
      if (!chosen.has(order[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < order.length && chosen.has(order[j])) j++;
      const before = i > 0 ? z.get(order[i - 1])! : null;
      const after = j < order.length ? z.get(order[j])! : null;
      // Unchanged runs keep their keys.
      const run = order.slice(i, j);
      const ordered =
        run.every(
          (id) =>
            (before === null || z.get(id)! > before) && (after === null || z.get(id)! < after),
        ) && run.every((id, k) => k === 0 || z.get(run[k - 1])! < z.get(id)!);
      if (!ordered) {
        const keys = keysBetween(before, after, run.length);
        run.forEach((id, k) => {
          z.set(id, keys[k]);
          writes.push({ id, z: keys[k] });
        });
      }
      i = j;
    }
  }
  if (writes.length === 0) return;
  doc.transact(() => {
    for (const w of writes) elements.get(w.id)?.set("z", w.z);
  }, origin);
}

// The frame a drop at `p` lands in: the topmost visible frame containing the
// point, other than the elements being moved and what's inside them.
export function frameAt(
  layout: Layout,
  all: All,
  p: Point,
  moving: ReadonlySet<string>,
): string | null {
  const excluded = withDescendants(moving, all);
  const order = paintOrder(all);
  for (let i = order.length - 1; i >= 0; i--) {
    const el = order[i];
    if (el.type !== "frame" || excluded.has(el.id)) continue;
    const g = layout.geom.get(el.id);
    if (!g || !containsPoint(g.rect, p)) continue;
    if (g.clip && !containsPoint(g.clip, p)) continue;
    return el.id;
  }
  return null;
}

// After a move: elements that sit at the top level or directly in a frame go
// into the frame under the pointer, or out to the top level when there's none.
// Elements inside groups stay in their group. Returns whether anything moved.
export function reparentAfterMove(
  doc: Y.Doc,
  ids: Iterable<string>,
  layout: Layout,
  p: Point,
  origin: unknown,
): boolean {
  const all = readElements(doc);
  const movable = topmostOnly(ids, all).filter((id) => {
    const parent = effectiveParent(all.get(id)!, all);
    return parent === null || all.get(parent)?.type === "frame";
  });
  if (movable.length === 0) return false;
  const frame = frameAt(layout, all, p, new Set(movable));
  const changing = movable.filter((id) => effectiveParent(all.get(id)!, all) !== frame);
  if (changing.length === 0) return false;
  moveTo(doc, changing, frame, origin);
  return true;
}

export type LayerRow = { id: string; depth: number };

// Each parent's children by id, bottom first, the shape DocState.children
// keeps up to date.
export function childIds(all: All): Map<string | null, string[]> {
  const out = new Map<string | null, string[]>();
  for (const [parent, list] of childrenByParent(all))
    out.set(
      parent,
      list.map((e) => e.id),
    );
  return out;
}

// The Layers panel: frames, groups and elements, top of the stack first, each
// container's children right under it. Built from the child lists alone, so
// it's recomputed only when the tree changes, not on every move.
export function layerRows(children: ReadonlyMap<string | null, readonly string[]>): LayerRow[] {
  const rows: LayerRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    const list = children.get(parent) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const id = list[i];
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, depth });
      walk(id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

// The rows of a fixed-height list worth rendering for a scroll position: the
// ones in view plus `overscan` either side. `last` is exclusive.
export function rowWindow(
  scrollTop: number,
  height: number,
  count: number,
  rowHeight: number,
  overscan = 8,
): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  return { first, last: Math.max(first, last) };
}
