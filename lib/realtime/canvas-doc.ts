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
  // sum along its parent chain (elementWorldPosition in canvas-threads.ts)
  // while nothing on it is rotated; threadPosition there handles rotation.
  x: number;
  y: number;
  w: number;
  h: number;
  // Degrees, clockwise, about the centre of the (x, y, w, h) box, which is the
  // box before rotation: CSS `rotate()` with its default transform origin, as
  // the renderer will apply it. A frame or group turns its children with it,
  // since their x/y are in its space. Nothing draws or edits rotation yet;
  // canvas threads already follow it (threadPosition in canvas-threads.ts).
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

// One end of a line or arrow: a free point, or bound to another element at a
// normalized anchor (0..1 on each axis of its box), so the end follows that
// element when it moves or resizes. A free point is relative to the
// connector's parent, like `x`/`y`, so a connector inside a frame or group
// moves with it; at the top level that is world space. A bound end keeps the
// last point it resolved to in `x`/`y` (same space), which is where it is drawn
// if its element disappears without the binding being cleared.
export type ConnectorEnd =
  | { kind: "point"; x: number; y: number }
  | { kind: "bound"; elementId: string; ax: number; ay: number; x?: number; y?: number };

export type StrokeKind = "pen" | "highlighter";
export type Routing = "straight" | "elbow";

// Every drawn element but `block` and `group` carries `opacity` (0..1). Colour
// fields hold token names from lib/canvas/style.ts.
export type ElementFields = {
  block: { columnId: number };
  // `text` holds a Y.Text so two people can type in one element. `stroke` is
  // the ink colour. `autoSize` is true until someone resizes the box by hand:
  // until then the width follows the text.
  text: {
    text: Y.Text;
    fontSize: string;
    weight: string;
    align: string;
    stroke: string;
    opacity: number;
    autoSize: boolean;
  };
  sticky: { text: Y.Text; fill: string; opacity: number };
  // Pen input points as a flat [x, y, pressure, ...] list, relative to (x, y),
  // rounded to a tenth of a pixel and pressure to hundredths.
  stroke: { points: number[]; stroke: string; width: number; opacity: number; kind: StrokeKind };
  rect: { stroke: string; fill: string; width: number; opacity: number };
  ellipse: { stroke: string; fill: string; width: number; opacity: number };
  diamond: { stroke: string; fill: string; width: number; opacity: number };
  // A connector's x/y/w/h is the box of its route, rewritten by the client that
  // moves either end, so the server's view of where it sits stays close.
  line: {
    start: ConnectorEnd;
    end: ConnectorEnd;
    stroke: string;
    width: number;
    opacity: number;
    routing: Routing;
  };
  arrow: {
    start: ConnectorEnd;
    end: ConnectorEnd;
    stroke: string;
    width: number;
    opacity: number;
    routing: Routing;
    startHead: string;
    endHead: string;
  };
  frame: { fill: string };
  // A group draws nothing. Its x/y is the origin its children are relative to;
  // its box is the union of its children's.
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
