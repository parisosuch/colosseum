// Reading and writing canvas elements on the client. The doc's shape lives in
// lib/realtime/canvas-doc.ts; this is the canvas page's view of it: plain
// snapshots to render from, world-space rectangles to hit-test, and the writes
// the select tool makes (place, move, resize, remove).
//
// Every write takes an `origin`, so the undo manager the drawing tools add can
// scope itself to this client's own edits.

import * as Y from "yjs";

import { elementsOf, type ElementType } from "@/lib/realtime/canvas-doc";
import { FIRST_POSITION, positionBetween } from "@/lib/fractional-index";
import type { Rect } from "./camera";
import type { Box } from "./geometry";

// A block's card is its media box plus two caption lines (title and age), as
// in the grid: pt-1 + 16px + 16px. Element heights include the caption, so the
// selection outline wraps the whole card.
export const BLOCK_CAPTION_HEIGHT = 36;
// A grid card at its common desktop width, so a placed block reads at 100% the
// way it does in the channel grid.
export const BLOCK_DEFAULT_WIDTH = 256;
export const BLOCK_DEFAULT_SIZE = {
  w: BLOCK_DEFAULT_WIDTH,
  h: BLOCK_DEFAULT_WIDTH + BLOCK_CAPTION_HEIGHT,
};
export const BLOCK_MIN_SIZE = { w: 64, h: 64 + BLOCK_CAPTION_HEIGHT };

export type ElementSnapshot = {
  id: string;
  type: ElementType;
  // Parent-relative, as stored.
  x: number;
  y: number;
  w: number;
  h: number;
  parentId: string | null;
  z: string;
  hidden: boolean;
  locked: boolean;
  // Set for `block` elements.
  columnId: number | null;
};

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function snapshotElement(id: string, el: Y.Map<unknown>): ElementSnapshot | null {
  const type = el.get("type");
  if (typeof type !== "string") return null;
  const columnId = el.get("columnId");
  return {
    id,
    type: type as ElementType,
    x: num(el.get("x")),
    y: num(el.get("y")),
    w: Math.max(0, num(el.get("w"))),
    h: Math.max(0, num(el.get("h"))),
    parentId: typeof el.get("parentId") === "string" ? (el.get("parentId") as string) : null,
    z: typeof el.get("z") === "string" ? (el.get("z") as string) : FIRST_POSITION,
    hidden: el.get("hidden") === true,
    locked: el.get("locked") === true,
    columnId: type === "block" && typeof columnId === "number" ? columnId : null,
  };
}

function sameSnapshot(a: ElementSnapshot, b: ElementSnapshot): boolean {
  return (
    a.type === b.type &&
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    a.parentId === b.parentId &&
    a.z === b.z &&
    a.hidden === b.hidden &&
    a.locked === b.locked &&
    a.columnId === b.columnId
  );
}

// Snapshot every element. With `previous`, an unchanged element keeps its old
// object, so memoized renderers skip it: dragging one block across a 500-block
// canvas re-renders one card.
export function readElements(
  doc: Y.Doc,
  previous?: ReadonlyMap<string, ElementSnapshot>,
): Map<string, ElementSnapshot> {
  const out = new Map<string, ElementSnapshot>();
  for (const [id, el] of elementsOf(doc).entries()) {
    const snap = snapshotElement(id, el);
    if (!snap) continue;
    const prev = previous?.get(id);
    out.set(id, prev && sameSnapshot(prev, snap) ? prev : snap);
  }
  return out;
}

// World position: the element's own x/y plus every parent's along the chain.
// A missing parent ends the chain (the element is treated as top level), and a
// cycle or a chain past 64 levels gives null, matching elementWorldPosition in
// canvas-threads.ts.
export function worldRect(
  el: ElementSnapshot,
  all: ReadonlyMap<string, ElementSnapshot>,
): Rect | null {
  let x = el.x;
  let y = el.y;
  let parentId = el.parentId;
  const seen = new Set<string>([el.id]);
  for (let depth = 0; parentId; depth++) {
    if (depth >= 64 || seen.has(parentId)) return null;
    seen.add(parentId);
    const parent = all.get(parentId);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    parentId = parent.parentId;
  }
  return { x, y, w: el.w, h: el.h };
}

// Paint order: siblings by `z`, id as the tie-break, children right after their
// parent. Only visible elements of the given types make it in.
export function paintOrder(
  all: ReadonlyMap<string, ElementSnapshot>,
  types: ReadonlySet<ElementType>,
): ElementSnapshot[] {
  const children = new Map<string | null, ElementSnapshot[]>();
  for (const el of all.values()) {
    const parent = el.parentId && all.has(el.parentId) ? el.parentId : null;
    const list = children.get(parent);
    if (list) list.push(el);
    else children.set(parent, [el]);
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const out: ElementSnapshot[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const el of children.get(parent) ?? []) {
      if (seen.has(el.id)) continue;
      seen.add(el.id);
      if (el.hidden) continue;
      if (types.has(el.type)) out.push(el);
      walk(el.id);
    }
  };
  walk(null);
  return out;
}

export function boxesOf(
  ordered: readonly ElementSnapshot[],
  all: ReadonlyMap<string, ElementSnapshot>,
): Box[] {
  const boxes: Box[] = [];
  for (const el of ordered) {
    const rect = worldRect(el, all);
    if (rect) boxes.push({ id: el.id, rect });
  }
  return boxes;
}

// The z key that puts a new element on top of the top-level stack.
export function topZ(all: ReadonlyMap<string, ElementSnapshot>): string {
  let max: string | null = null;
  for (const el of all.values()) {
    if (el.parentId) continue;
    if (max === null || el.z > max) max = el.z;
  }
  return max === null ? FIRST_POSITION : positionBetween(max, null);
}

export function newElementId(): string {
  // crypto.randomUUID is only defined in secure contexts; a LAN dev server over
  // plain http isn't one.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Put a block on the canvas, top-level and on top of everything. `at` is the
// world point the card's centre lands on.
export function placeBlock(
  doc: Y.Doc,
  input: { columnId: number; at: { x: number; y: number }; createdBy: string; id?: string },
  origin: unknown,
): string {
  const id = input.id ?? newElementId();
  const z = topZ(readElements(doc));
  const { w, h } = BLOCK_DEFAULT_SIZE;
  doc.transact(() => {
    const el = new Y.Map<unknown>();
    el.set("type", "block");
    el.set("x", Math.round(input.at.x - w / 2));
    el.set("y", Math.round(input.at.y - h / 2));
    el.set("w", w);
    el.set("h", h);
    el.set("rotation", 0);
    el.set("parentId", null);
    el.set("z", z);
    el.set("name", null);
    el.set("locked", false);
    el.set("hidden", false);
    el.set("createdBy", input.createdBy);
    el.set("columnId", input.columnId);
    elementsOf(doc).set(id, el);
  }, origin);
  return id;
}

// Write stored (parent-relative) geometry. Only the fields given change, and
// unknown ids are skipped: someone else may have deleted the element mid-drag.
export function setGeometry(
  doc: Y.Doc,
  updates: readonly { id: string; x?: number; y?: number; w?: number; h?: number }[],
  origin: unknown,
): void {
  const elements = elementsOf(doc);
  doc.transact(() => {
    for (const u of updates) {
      const el = elements.get(u.id);
      if (!el) continue;
      for (const key of ["x", "y", "w", "h"] as const) {
        const v = u[key];
        if (v === undefined || !Number.isFinite(v)) continue;
        // Integers keep the doc small (a float is 9 bytes in Yjs) and nobody
        // can see a sub-pixel position at 100%.
        const rounded = Math.round(v);
        if (el.get(key) !== rounded) el.set(key, rounded);
      }
    }
  }, origin);
}

export function removeElements(doc: Y.Doc, ids: Iterable<string>, origin: unknown): void {
  const elements = elementsOf(doc);
  doc.transact(() => {
    for (const id of ids) elements.delete(id);
  }, origin);
}

// The column ids that have a block element. The doc can hold two elements for
// one block if two people drop it at the same moment; both stay, and the block
// is simply placed.
export function placedColumns(all: ReadonlyMap<string, ElementSnapshot>): Set<number> {
  const ids = new Set<number>();
  for (const el of all.values()) if (el.columnId != null) ids.add(el.columnId);
  return ids;
}
