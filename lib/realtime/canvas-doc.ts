// The shape of a channel's canvas document. One Y.Doc per channel, shared by
// the realtime server and every client, so this module imports nothing from
// the server side.
//
// The doc holds a single top-level map, `elements`, of element id → Y.Map.
// Every element carries the base fields below; the per-type fields follow. A
// `block` element stores where a block sits and nothing about what it is: the
// `column` row stays the source of truth for content, and the canvas looks it
// up by `columnId`.
//
// Style values (stroke, fill, font size) are design-token names, not colours,
// so drawings follow light and dark mode.

import * as Y from "yjs";

export const ELEMENTS_KEY = "elements";

export const ELEMENT_TYPES = [
  "block",
  "text",
  "stroke",
  "rect",
  "ellipse",
  "diamond",
  "sticky",
  "line",
  "arrow",
  "frame",
  "group",
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

export type BaseElement = {
  type: ElementType;
  // Position relative to the parent frame or group (`parentId`), so moving a
  // frame writes one position and its children follow. A top-level element
  // (parentId null) is in world space, and an element's world position is the
  // sum along its parent chain (elementWorldPosition in canvas-threads.ts).
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  // The frame or group this element sits in; null at the top level. Parent
  // links are what make the layer tree.
  parentId: string | null;
  // Fractional-index key (lib/fractional-index.ts) ordering the element among
  // its siblings. Keys rather than integers, so two people reordering at once
  // don't collide.
  z: string;
  // Layer name; null falls back to a label derived from the type.
  name: string | null;
  locked: boolean;
  hidden: boolean;
  // User id of whoever made it.
  createdBy: string;
};

// One end of a line or arrow: a free point in world space, or bound to another
// element at a normalized anchor (0..1 on each axis of its box), so the end
// follows that element when it moves or resizes.
export type ConnectorEnd =
  | { kind: "point"; x: number; y: number }
  | { kind: "bound"; elementId: string; ax: number; ay: number };

export type ElementFields = {
  block: { columnId: number };
  // `text` holds a Y.Text so two people can type in one element.
  text: { text: Y.Text; fontSize: string; weight: string; align: string };
  sticky: { text: Y.Text; fill: string };
  // Pen input points as a flat [x, y, pressure, ...] list, relative to (x, y).
  stroke: { points: number[]; stroke: string; width: number; opacity: number };
  rect: { stroke: string; fill: string; width: number };
  ellipse: { stroke: string; fill: string; width: number };
  diamond: { stroke: string; fill: string; width: number };
  line: { start: ConnectorEnd; end: ConnectorEnd; stroke: string; width: number };
  arrow: {
    start: ConnectorEnd;
    end: ConnectorEnd;
    stroke: string;
    width: number;
    startHead: string;
    endHead: string;
  };
  frame: { fill: string };
  group: Record<string, never>;
};

export function elementsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(ELEMENTS_KEY);
}

// Column ids of every block placed on the canvas. The unplaced-blocks sidebar
// is the channel's blocks minus these.
export function placedColumnIds(doc: Y.Doc): Set<number> {
  const ids = new Set<number>();
  for (const el of elementsOf(doc).values()) {
    if (el.get("type") === "block") ids.add(el.get("columnId") as number);
  }
  return ids;
}

// Remove every block element whose column fails `keep`. Returns how many went.
// One transaction, so clients see a single change and undo can't bring a
// deleted block back piecemeal.
export function removeBlockElements(
  doc: Y.Doc,
  keep: (columnId: number) => boolean,
  origin: unknown,
): number {
  const elements = elementsOf(doc);
  const doomed: string[] = [];
  for (const [id, el] of elements.entries()) {
    if (el.get("type") === "block" && !keep(el.get("columnId") as number)) doomed.push(id);
  }
  if (doomed.length > 0) {
    doc.transact(() => {
      for (const id of doomed) elements.delete(id);
    }, origin);
  }
  return doomed.length;
}
