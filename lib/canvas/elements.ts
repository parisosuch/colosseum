// Reading and writing canvas elements on the client. The doc's shape lives in
// lib/realtime/canvas-doc.ts; this is the canvas page's view of it: plain
// snapshots to render from, and the writes every tool shares (create, place,
// move, resize, restyle, remove).
//
// Every write takes an `origin`. The page's undo manager tracks only the local
// client's origin, so one person's undo never reverts someone else's edit.

import * as Y from "yjs";

import {
  elementsOf,
  type ConnectorEnd,
  type ElementType,
  type Routing,
  type StrokeKind,
} from "@/lib/realtime/canvas-doc";
import { FIRST_POSITION, isPosition, positionBetween } from "@/lib/fractional-index";
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

export const CONNECTOR_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(["line", "arrow"]);
export const CONTAINER_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(["frame", "group"]);

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
  name: string | null;
  hidden: boolean;
  locked: boolean;
  // Set for `block` elements.
  columnId: number | null;
  // Style. Absent fields are null (or the type's neutral value).
  stroke: string | null;
  fill: string | null;
  width: number;
  opacity: number;
  // Text and sticky.
  text: string | null;
  fontSize: string | null;
  weight: string | null;
  align: string | null;
  autoSize: boolean;
  // Pen.
  points: readonly number[] | null;
  kind: StrokeKind | null;
  // Line and arrow.
  start: ConnectorEnd | null;
  end: ConnectorEnd | null;
  routing: Routing | null;
  startHead: string | null;
  endHead: string | null;
};

const SNAPSHOT_KEYS = [
  "type",
  "x",
  "y",
  "w",
  "h",
  "parentId",
  "z",
  "name",
  "hidden",
  "locked",
  "columnId",
  "stroke",
  "fill",
  "width",
  "opacity",
  "text",
  "fontSize",
  "weight",
  "align",
  "autoSize",
  "points",
  "kind",
  "start",
  "end",
  "routing",
  "startHead",
  "endHead",
] as const satisfies readonly (keyof ElementSnapshot)[];

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function connectorEnd(v: unknown): ConnectorEnd | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  if (e.kind === "point" && typeof e.x === "number" && typeof e.y === "number") {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return null;
    return v as ConnectorEnd;
  }
  if (e.kind === "bound" && typeof e.elementId === "string") {
    if (typeof e.ax !== "number" || typeof e.ay !== "number") return null;
    return v as ConnectorEnd;
  }
  return null;
}

function pointList(v: unknown): readonly number[] | null {
  if (!Array.isArray(v)) return null;
  return v.length % 3 === 0 && v.every((n) => typeof n === "number" && Number.isFinite(n))
    ? v
    : null;
}

export function snapshotElement(id: string, el: Y.Map<unknown>): ElementSnapshot | null {
  return snapshotFrom(id, (k) => el.get(k));
}

// A snapshot of an element that isn't in a doc yet (a shape being drawn), from
// the same fields `createElement` takes.
export function snapshotOf(id: string, input: NewElement): ElementSnapshot {
  const fields: Record<string, unknown> = { parentId: null, ...input };
  return snapshotFrom(id, (k) => fields[k])!;
}

function snapshotFrom(id: string, get: (key: string) => unknown): ElementSnapshot | null {
  const type = get("type");
  if (typeof type !== "string") return null;
  const columnId = get("columnId");
  const text = get("text");
  const z = get("z");
  const connector = CONNECTOR_TYPES.has(type as ElementType);
  return {
    id,
    type: type as ElementType,
    x: num(get("x")),
    y: num(get("y")),
    w: Math.max(0, num(get("w"))),
    h: Math.max(0, num(get("h"))),
    parentId: typeof get("parentId") === "string" ? (get("parentId") as string) : null,
    z: typeof z === "string" && isPosition(z) ? z : FIRST_POSITION,
    name: str(get("name")),
    hidden: get("hidden") === true,
    locked: get("locked") === true,
    columnId: type === "block" && typeof columnId === "number" ? columnId : null,
    stroke: str(get("stroke")),
    fill: str(get("fill")),
    width: Math.max(0, num(get("width"), 2)),
    opacity: Math.min(1, Math.max(0, num(get("opacity"), 1))),
    text: text instanceof Y.Text ? text.toString() : typeof text === "string" ? text : null,
    fontSize: str(get("fontSize")),
    weight: str(get("weight")),
    align: str(get("align")),
    autoSize: get("autoSize") === true,
    points: type === "stroke" ? pointList(get("points")) : null,
    kind: type === "stroke" ? (get("kind") === "highlighter" ? "highlighter" : "pen") : null,
    start: connector ? connectorEnd(get("start")) : null,
    end: connector ? connectorEnd(get("end")) : null,
    routing: connector ? (get("routing") === "elbow" ? "elbow" : "straight") : null,
    startHead: str(get("startHead")),
    endHead: str(get("endHead")),
  };
}

function sameSnapshot(a: ElementSnapshot, b: ElementSnapshot): boolean {
  for (const k of SNAPSHOT_KEYS) if (a[k] !== b[k]) return false;
  return true;
}

// Snapshot every element. With `previous`, an unchanged element keeps its old
// object, so memoized renderers skip it: dragging one block across a 500-block
// canvas re-renders one card. Point lists and connector ends are the doc's own
// values, which keep their identity until they're rewritten.
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

// The world position of an element's coordinate space: the sum of its
// parents' x/y. A missing parent ends the chain (the element is treated as top
// level), and a cycle or a chain past 64 levels gives null, matching
// elementWorldPosition in canvas-threads.ts.
export function parentOrigin(
  el: { id: string; parentId: string | null },
  all: ReadonlyMap<string, ElementSnapshot>,
): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
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
  return { x, y };
}

// World rect from the stored box. Right for everything but connectors and
// groups, whose boxes come from layout.ts.
export function worldRect(
  el: ElementSnapshot,
  all: ReadonlyMap<string, ElementSnapshot>,
): Rect | null {
  const o = parentOrigin(el, all);
  return o ? { x: el.x + o.x, y: el.y + o.y, w: el.w, h: el.h } : null;
}

// The parent an element actually hangs off: its parentId if that element
// exists, otherwise the top level.
export function effectiveParent(
  el: ElementSnapshot,
  all: ReadonlyMap<string, ElementSnapshot>,
): string | null {
  return el.parentId && all.has(el.parentId) ? el.parentId : null;
}

function byZ(a: ElementSnapshot, b: ElementSnapshot): number {
  return a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Siblings of every parent, bottom first.
export function childrenByParent(
  all: ReadonlyMap<string, ElementSnapshot>,
): Map<string | null, ElementSnapshot[]> {
  const children = new Map<string | null, ElementSnapshot[]>();
  for (const el of all.values()) {
    const parent = effectiveParent(el, all);
    const list = children.get(parent);
    if (list) list.push(el);
    else children.set(parent, [el]);
  }
  for (const list of children.values()) list.sort(byZ);
  return children;
}

// Paint order: siblings by `z`, id as the tie-break, children right after their
// parent. Only visible elements of the given types make it in; a hidden
// element hides everything inside it.
export function paintOrder(
  all: ReadonlyMap<string, ElementSnapshot>,
  types?: ReadonlySet<ElementType>,
): ElementSnapshot[] {
  const children = childrenByParent(all);
  const out: ElementSnapshot[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const el of children.get(parent) ?? []) {
      if (seen.has(el.id)) continue;
      seen.add(el.id);
      if (el.hidden) continue;
      if (!types || types.has(el.type)) out.push(el);
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

// A z key strictly between two neighbours, either of which may be null. Keys
// written by two people at once can tie; a tie puts the new key just above.
export function zBetween(a: string | null, b: string | null): string {
  try {
    return positionBetween(a, b !== null && a !== null && b <= a ? null : b);
  } catch {
    return positionBetween(a, null);
  }
}

// The z key that puts a new element on top of `parentId`'s children.
export function topZ(
  all: ReadonlyMap<string, ElementSnapshot>,
  parentId: string | null = null,
): string {
  let max: string | null = null;
  for (const el of all.values()) {
    if (effectiveParent(el, all) !== parentId) continue;
    if (max === null || el.z > max) max = el.z;
  }
  return max === null ? FIRST_POSITION : zBetween(max, null);
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

// Fields every new element carries, plus its type's own. `text` is a string
// here and becomes a Y.Text.
export type NewElement = {
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  parentId?: string | null;
  z?: string;
  name?: string | null;
  createdBy: string;
  [field: string]: unknown;
};

// Build an element's Y.Map. Positions are rounded to whole pixels, like every
// geometry write.
export function elementMap(
  input: NewElement,
  all: ReadonlyMap<string, ElementSnapshot>,
): Y.Map<unknown> {
  const parentId = input.parentId ?? null;
  const fields: Record<string, unknown> = { rotation: 0, name: null, locked: false, hidden: false };
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || k === "parentId" || k === "z") continue;
    if (k === "text") fields.text = new Y.Text(typeof v === "string" ? v : "");
    else if (k === "x" || k === "y" || k === "w" || k === "h") fields[k] = Math.round(v as number);
    else fields[k] = v;
  }
  fields.parentId = parentId;
  fields.z = input.z ?? topZ(all, parentId);
  // A prelim Y.Map can be written but not read, so it's filled in one go.
  const el = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) el.set(k, v);
  return el;
}

// Add one element, on top of its parent's children unless it brings a z.
export function createElement(
  doc: Y.Doc,
  input: NewElement & { id?: string },
  origin: unknown,
): string {
  const { id: given, ...rest } = input;
  const id = given ?? newElementId();
  const all = readElements(doc);
  doc.transact(() => {
    elementsOf(doc).set(id, elementMap(rest, all));
  }, origin);
  return id;
}

// Put a block on the canvas, top-level and on top of everything. `at` is the
// world point the card's centre lands on.
export function placeBlock(
  doc: Y.Doc,
  input: { columnId: number; at: { x: number; y: number }; createdBy: string; id?: string },
  origin: unknown,
): string {
  const { w, h } = BLOCK_DEFAULT_SIZE;
  return createElement(
    doc,
    {
      id: input.id,
      type: "block",
      x: input.at.x - w / 2,
      y: input.at.y - h / 2,
      w,
      h,
      createdBy: input.createdBy,
      columnId: input.columnId,
    },
    origin,
  );
}

export type GeometryUpdate = { id: string; x?: number; y?: number; w?: number; h?: number };

export function writeGeometry(elements: Y.Map<Y.Map<unknown>>, updates: readonly GeometryUpdate[]) {
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
}

// Write stored (parent-relative) geometry. Only the fields given change, and
// unknown ids are skipped: someone else may have deleted the element mid-drag.
export function setGeometry(doc: Y.Doc, updates: readonly GeometryUpdate[], origin: unknown): void {
  const elements = elementsOf(doc);
  doc.transact(() => writeGeometry(elements, updates), origin);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return (
    !!a &&
    !!b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !(a instanceof Y.AbstractType) &&
    JSON.stringify(a) === JSON.stringify(b)
  );
}

export function writeProps(
  elements: Y.Map<Y.Map<unknown>>,
  updates: readonly { id: string; props: Record<string, unknown> }[],
): void {
  for (const u of updates) {
    const el = elements.get(u.id);
    if (!el) continue;
    for (const [k, v] of Object.entries(u.props)) {
      if (v === undefined || sameValue(el.get(k), v)) continue;
      el.set(k, v);
    }
  }
}

// Set arbitrary fields. A value equal to what's stored isn't rewritten, so a
// panel that sets the colour every element already has sends nothing.
export function setProps(
  doc: Y.Doc,
  updates: readonly { id: string; props: Record<string, unknown> }[],
  origin: unknown,
): void {
  const elements = elementsOf(doc);
  doc.transact(() => writeProps(elements, updates), origin);
}

// Every id in `ids` plus everything inside them.
export function withDescendants(
  ids: Iterable<string>,
  all: ReadonlyMap<string, ElementSnapshot>,
): Set<string> {
  const children = childrenByParent(all);
  const out = new Set<string>();
  const add = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const c of children.get(id) ?? []) add(c.id);
  };
  for (const id of ids) if (all.has(id)) add(id);
  return out;
}

// Remove elements and everything inside them, in one transaction. Connectors
// bound to a removed element keep their end where it was drawn, as a free
// point, and a group left with no children goes too. `resolved` is where each
// bound end is drawn now (layout.ts), keyed `${id}:start` / `${id}:end` and in
// the connector's parent space; without it the end's cached point is used.
export function removeElements(
  doc: Y.Doc,
  ids: Iterable<string>,
  origin: unknown,
  resolved?: ReadonlyMap<string, { x: number; y: number }>,
): void {
  const elements = elementsOf(doc);
  const all = readElements(doc);
  const list = [...ids];
  const doomed = withDescendants(list, all);
  // Ids not in the snapshot (malformed elements) still go.
  for (const id of list) doomed.add(id);
  doc.transact(() => {
    for (const el of all.values()) {
      if (doomed.has(el.id) || !CONNECTOR_TYPES.has(el.type)) continue;
      for (const side of ["start", "end"] as const) {
        const end = el[side];
        if (end?.kind !== "bound" || !doomed.has(end.elementId)) continue;
        const at = resolved?.get(`${el.id}:${side}`) ?? { x: end.x ?? el.x, y: end.y ?? el.y };
        elements.get(el.id)?.set(side, { kind: "point", x: Math.round(at.x), y: Math.round(at.y) });
      }
    }
    for (const id of doomed) elements.delete(id);
    removeEmptyGroups(elements, all, doomed);
  }, origin);
}

// Groups that lost their last child, walking up, since a group with nothing
// in it has no box and nothing to draw.
export function removeEmptyGroups(
  elements: Y.Map<Y.Map<unknown>>,
  all: ReadonlyMap<string, ElementSnapshot>,
  removedOrMoved: ReadonlySet<string>,
): void {
  const candidates = new Set<string>();
  for (const id of removedOrMoved) {
    const p = all.get(id)?.parentId;
    if (p) candidates.add(p);
  }
  for (const groupId of candidates) {
    let id: string | null = groupId;
    while (id) {
      const g = elements.get(id);
      if (!g || g.get("type") !== "group") break;
      let hasChild = false;
      for (const el of elements.values()) {
        if (el.get("parentId") === id) {
          hasChild = true;
          break;
        }
      }
      if (hasChild) break;
      const parent = g.get("parentId");
      elements.delete(id);
      id = typeof parent === "string" ? parent : null;
    }
  }
}

// The column ids that have a block element. The doc can hold two elements for
// one block if two people drop it at the same moment; both stay, and the block
// is simply placed.
export function placedColumns(all: ReadonlyMap<string, ElementSnapshot>): Set<number> {
  const ids = new Set<number>();
  for (const el of all.values()) if (el.columnId != null) ids.add(el.columnId);
  return ids;
}

// A label for an element that has no name: the Layers panel's fallback.
export function defaultName(el: ElementSnapshot): string {
  switch (el.type) {
    case "text":
      return el.text?.trim().split("\n")[0]?.slice(0, 60) || "Text";
    case "sticky":
      return el.text?.trim().split("\n")[0]?.slice(0, 60) || "Sticky note";
    case "stroke":
      return el.kind === "highlighter" ? "Highlighter" : "Pen stroke";
    case "rect":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "diamond":
      return "Diamond";
    case "line":
      return "Line";
    case "arrow":
      return "Arrow";
    case "frame":
      return "Frame";
    case "group":
      return "Group";
    case "block":
      return "Block";
  }
}
