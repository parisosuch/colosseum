// Copy, cut, paste and duplicate inside the canvas, and between channels.
//
// Elements go on the clipboard as JSON under our own MIME type, with a
// plain-text version alongside for pasting into anything else. The payload
// holds the copied elements and everything inside them, with the top ones in
// world space; pasting gives every element a new id, keeps bindings between
// pasted elements, and turns bindings to anything left behind into free ends.
//
// Blocks are pasted only into the channel they came from, and only if they
// aren't on the canvas already (a cut and paste moves them). A block from
// another channel isn't in this one; the paste-from-outside handler is where
// turning it into a new block would go.

import * as Y from "yjs";

import { ELEMENT_TYPES, elementsOf, type ElementType } from "@/lib/realtime/canvas-doc";
import type { Point } from "./camera";
import {
  CONNECTOR_TYPES,
  elementMap,
  newElementId,
  parentOrigin,
  readElements,
  topZ,
  withDescendants,
  zBetween,
  type ElementSnapshot,
  type KnownDoc,
} from "./elements";
import { unionRects } from "./geometry";
import type { Layout } from "./layout";
import { topmostOnly } from "./tree";

// The "web " prefix is the async clipboard's convention for custom formats.
export const CANVAS_MIME = "web application/x-colosseum-canvas+json";

export const PASTE_OFFSET = 24;

export type ClipElement = { id: string; parentId: string | null; fields: Record<string, unknown> };

export type CanvasClipboard = {
  kind: "colosseum-canvas";
  version: 1;
  channelId: number;
  elements: ClipElement[];
};

// Fields that travel. Anything else on an element (or in a hostile payload)
// stays behind. Rotation stays behind too: nothing draws, hits or lays out a
// rotated element yet, and only comment pins would turn with it.
const FIELDS = new Set([
  "type",
  "x",
  "y",
  "w",
  "h",
  "z",
  "name",
  "locked",
  "hidden",
  "columnId",
  "text",
  "fontSize",
  "weight",
  "align",
  "autoSize",
  "stroke",
  "fill",
  "width",
  "opacity",
  "points",
  "kind",
  "start",
  "end",
  "routing",
  "startHead",
  "endHead",
]);

function plainFields(m: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of m.entries()) {
    if (!FIELDS.has(k)) continue;
    out[k] = v instanceof Y.Text ? v.toString() : v;
  }
  return out;
}

function shiftEnd(end: unknown, dx: number, dy: number): unknown {
  if (!end || typeof end !== "object") return end;
  const e = end as Record<string, unknown>;
  if (typeof e.x !== "number" || typeof e.y !== "number") return end;
  return { ...e, x: Math.round(e.x + dx), y: Math.round(e.y + dy) };
}

// Copy `ids` (and what's inside them). Null when nothing is copyable.
export function copySelection(
  doc: Y.Doc,
  ids: Iterable<string>,
  layout: Layout,
  channelId: number,
  known: KnownDoc = { elements: readElements(doc) },
): CanvasClipboard | null {
  const all = known.elements;
  const roots = topmostOnly(ids, all);
  if (roots.length === 0) return null;
  const rootSet = new Set(roots);
  const elements = elementsOf(doc);
  const out: ClipElement[] = [];
  for (const id of withDescendants(roots, all, known.children)) {
    const m = elements.get(id);
    const el = all.get(id);
    if (!m || !el) continue;
    const fields = plainFields(m);
    let parentId = el.parentId;
    if (rootSet.has(id)) {
      // Top-level in the payload, in world space.
      const o = parentOrigin(el, all) ?? { x: 0, y: 0 };
      fields.x = el.x + o.x;
      fields.y = el.y + o.y;
      if (CONNECTOR_TYPES.has(el.type)) {
        fields.start = shiftEnd(layoutEnd(el, "start", layout) ?? fields.start, o.x, o.y);
        fields.end = shiftEnd(layoutEnd(el, "end", layout) ?? fields.end, o.x, o.y);
      }
      parentId = null;
    }
    out.push({ id, parentId, fields });
  }
  return { kind: "colosseum-canvas", version: 1, channelId, elements: out };
}

// A bound end with the point it's drawn at now, so a paste without its target
// can leave it there.
function layoutEnd(el: ElementSnapshot, side: "start" | "end", layout: Layout): unknown {
  const end = el[side];
  const at = layout.ends.get(`${el.id}:${side}`);
  if (end?.kind === "bound" && at) return { ...end, x: Math.round(at.x), y: Math.round(at.y) };
  return null;
}

// Text for other apps: what the copied text and notes say, or a count.
export function clipboardText(clip: CanvasClipboard): string {
  const texts = clip.elements
    .filter(
      (e) =>
        (e.fields.type === "text" || e.fields.type === "sticky") &&
        typeof e.fields.text === "string",
    )
    .map((e) => (e.fields.text as string).trim())
    .filter(Boolean);
  if (texts.length) return texts.join("\n\n");
  const n = clip.elements.filter((e) => e.parentId === null).length;
  return n === 1 ? "1 canvas element" : `${n} canvas elements`;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Parse and check a payload. Anything malformed gives null rather than half a
// paste.
export function parseClipboard(raw: string | null | undefined): CanvasClipboard | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = data as Partial<CanvasClipboard>;
  if (!d || d.kind !== "colosseum-canvas" || d.version !== 1 || !finite(d.channelId)) return null;
  if (!Array.isArray(d.elements) || d.elements.length === 0 || d.elements.length > 5000)
    return null;
  const ids = new Set<string>();
  const elements: ClipElement[] = [];
  for (const e of d.elements) {
    if (!e || typeof e.id !== "string" || ids.has(e.id)) return null;
    if (e.parentId !== null && typeof e.parentId !== "string") return null;
    const f = e.fields;
    if (!f || typeof f !== "object") return null;
    if (!(ELEMENT_TYPES as readonly string[]).includes(f.type as string)) return null;
    if (![f.x, f.y, f.w, f.h].every(finite)) return null;
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) if (FIELDS.has(k)) fields[k] = v;
    ids.add(e.id);
    elements.push({ id: e.id, parentId: e.parentId, fields });
  }
  // A parent that isn't in the payload makes the element a top one.
  for (const e of elements) if (e.parentId && !ids.has(e.parentId)) e.parentId = null;
  return { kind: "colosseum-canvas", version: 1, channelId: d.channelId, elements };
}

export type PasteOptions = {
  channelId: number;
  createdBy: string;
  // Column ids already on this canvas.
  placed: ReadonlySet<number>;
  // Where the middle of the pasted elements lands, in world space; without it
  // they land PASTE_OFFSET right and down of where they were copied from.
  at?: Point | null;
  // The doc as the caller already has it (see KnownDoc).
  known?: KnownDoc;
};

// Paste a payload. Returns the new ids of the top pasted elements, for the
// selection.
export function pasteClipboard(
  doc: Y.Doc,
  clip: CanvasClipboard,
  opts: PasteOptions,
  origin: unknown,
): string[] {
  const sameChannel = clip.channelId === opts.channelId;
  // Drop blocks that can't be pasted here, and everything inside a dropped
  // element.
  const dropped = new Set<string>();
  for (const e of clip.elements) {
    if (e.fields.type !== "block") continue;
    const col = e.fields.columnId;
    if (!sameChannel || !finite(col) || opts.placed.has(col)) dropped.add(e.id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of clip.elements) {
      if (!dropped.has(e.id) && e.parentId && dropped.has(e.parentId)) {
        dropped.add(e.id);
        changed = true;
      }
    }
  }
  const kept = clip.elements.filter((e) => !dropped.has(e.id));
  if (kept.length === 0) return [];
  const roots = kept.filter((e) => e.parentId === null);

  let dx = PASTE_OFFSET;
  let dy = PASTE_OFFSET;
  if (opts.at) {
    const bounds = unionRects(
      roots.map((r) => ({
        x: r.fields.x as number,
        y: r.fields.y as number,
        w: r.fields.w as number,
        h: r.fields.h as number,
      })),
    );
    if (bounds) {
      dx = opts.at.x - (bounds.x + bounds.w / 2);
      dy = opts.at.y - (bounds.y + bounds.h / 2);
    }
  }

  const idMap = new Map(kept.map((e) => [e.id, newElementId()]));
  const all = opts.known?.elements ?? readElements(doc);
  const children = opts.known?.children;
  const elements = elementsOf(doc);
  // Top elements go on top of the canvas, in their copied order.
  const sortedRoots = [...roots].sort((a, b) => (String(a.fields.z) < String(b.fields.z) ? -1 : 1));
  const rootZ = new Map<string, string>();
  let prev: string | null = null;
  const top = topZ(all, null, children);
  for (const r of sortedRoots) {
    prev = prev === null ? top : zBetween(prev, null);
    rootZ.set(r.id, prev);
  }

  const fixEnd = (end: unknown, isRoot: boolean): unknown => {
    if (!end || typeof end !== "object") return end;
    const e = end as Record<string, unknown>;
    if (e.kind === "bound" && typeof e.elementId === "string") {
      const target = idMap.get(e.elementId);
      if (target) return { ...e, elementId: target, ...(isRoot ? shiftEndXY(e, dx, dy) : {}) };
      if (finite(e.x) && finite(e.y)) {
        const p = isRoot ? { x: e.x + dx, y: e.y + dy } : { x: e.x, y: e.y };
        return { kind: "point", x: Math.round(p.x), y: Math.round(p.y) };
      }
      return { kind: "point", x: 0, y: 0 };
    }
    if (e.kind === "point" && finite(e.x) && finite(e.y)) {
      return isRoot ? { kind: "point", x: Math.round(e.x + dx), y: Math.round(e.y + dy) } : e;
    }
    return end;
  };

  // Each transaction goes to the server as one message, and the server refuses
  // a writer's message over 2 MiB and drops the tab's connection for good. A
  // paste of a few hundred strokes is more than that, so a big paste goes in
  // several transactions, parents before what's inside them. They share an
  // origin and land together, so undo still takes them back in one step.
  for (const batch of pasteBatches(kept)) {
    doc.transact(() => {
      for (const e of batch) writeOne(e);
    }, origin);
  }
  return sortedRoots.map((r) => idMap.get(r.id)!);

  function writeOne(e: ClipElement) {
    const isRoot = e.parentId === null;
    const f = { ...e.fields };
    if (isRoot) {
      f.x = (f.x as number) + dx;
      f.y = (f.y as number) + dy;
    }
    if (CONNECTOR_TYPES.has(f.type as ElementType)) {
      f.start = fixEnd(f.start, isRoot);
      f.end = fixEnd(f.end, isRoot);
    }
    const z = isRoot ? rootZ.get(e.id)! : typeof f.z === "string" ? f.z : undefined;
    delete f.z;
    const m = elementMap(
      {
        ...(f as { type: ElementType; x: number; y: number; w: number; h: number }),
        parentId: isRoot ? null : idMap.get(e.parentId!)!,
        z,
        createdBy: opts.createdBy,
      },
      all,
      children,
    );
    elements.set(idMap.get(e.id)!, m);
  }
}

// What one transaction of a paste may hold, by the estimate below: a quarter
// of the server's 2 MiB per message, since the estimate is rough.
export const PASTE_BATCH_BYTES = 512 * 1024;

// About what an element costs in a Yjs update: its JSON, doubled, because
// Yjs writes a non-integer number (every pen point) in 9 bytes where JSON
// spends 4 to 6 characters.
function roughBytes(e: ClipElement): number {
  return 2 * JSON.stringify(e.fields).length + 64;
}

// The paste in order, cut into runs under PASTE_BATCH_BYTES. Children follow
// their parents, so each run's elements have their parents in it or before it.
export function pasteBatches(elements: readonly ClipElement[]): ClipElement[][] {
  const depth = new Map<string, number>();
  const byId = new Map(elements.map((e) => [e.id, e]));
  const depthOf = (e: ClipElement): number => {
    const known = depth.get(e.id);
    if (known !== undefined) return known;
    depth.set(e.id, 0);
    const parent = e.parentId ? byId.get(e.parentId) : undefined;
    const d = parent ? depthOf(parent) + 1 : 0;
    depth.set(e.id, d);
    return d;
  };
  const ordered = [...elements].sort((a, b) => depthOf(a) - depthOf(b));
  const batches: ClipElement[][] = [];
  let batch: ClipElement[] = [];
  let bytes = 0;
  for (const e of ordered) {
    const size = roughBytes(e);
    if (batch.length && bytes + size > PASTE_BATCH_BYTES) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(e);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function shiftEndXY(e: Record<string, unknown>, dx: number, dy: number): Record<string, unknown> {
  return finite(e.x) && finite(e.y) ? { x: Math.round(e.x + dx), y: Math.round(e.y + dy) } : {};
}

// Duplicate: copy and paste in one step, offset from the originals. Blocks
// aren't duplicated, since each block has one place on the canvas.
export function duplicateSelection(
  doc: Y.Doc,
  ids: Iterable<string>,
  layout: Layout,
  opts: Omit<PasteOptions, "at">,
  origin: unknown,
): string[] {
  const clip = copySelection(doc, ids, layout, opts.channelId, opts.known);
  if (!clip) return [];
  return pasteClipboard(doc, clip, opts, origin);
}
