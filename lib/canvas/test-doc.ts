// Helpers for the canvas logic tests: a doc with elements written straight
// in, and its snapshot and layout.

import * as Y from "yjs";

import { positionsAfter } from "@/lib/fractional-index";
import { elementsOf } from "@/lib/realtime/canvas-doc";
import { elementMap, readElements, type NewElement } from "./elements";
import { computeLayout } from "./layout";

export const ORIGIN = Symbol("test-origin");

export function docWith(
  elements: Record<string, Partial<NewElement> & { type: NewElement["type"] }>,
): Y.Doc {
  const doc = new Y.Doc();
  const map = elementsOf(doc);
  doc.transact(() => {
    let i = 0;
    for (const [id, e] of Object.entries(elements)) {
      const all = readElements(doc);
      map.set(
        id,
        elementMap(
          {
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            createdBy: "u",
            z: e.z ?? `i${String(i++).padStart(5, "0")}`,
            ...e,
          } as NewElement,
          all,
        ),
      );
    }
  });
  return doc;
}

export function state(doc: Y.Doc) {
  const all = readElements(doc);
  return { all, layout: computeLayout(all) };
}

// A board the size of a heavy real one, for the incremental-update tests and
// the benchmark: blocks, shapes, pen strokes, frames holding children, groups,
// and lines bound to shapes, in proportions like a working board's.
export function bigBoard(n: number): Y.Doc {
  const doc = new Y.Doc();
  const map = elementsOf(doc);
  let rand = 1;
  const next = () => {
    rand = (rand * 48271) % 2147483647;
    return rand / 2147483647;
  };
  const put = (id: string, fields: Record<string, unknown>) => {
    const el = new Y.Map<unknown>();
    for (const [k, v] of Object.entries({ rotation: 0, locked: false, hidden: false, ...fields }))
      el.set(k, v);
    map.set(id, el);
  };
  const keys = positionsAfter(null, n);
  doc.transact(() => {
    const frames = Math.max(1, Math.floor(n / 100));
    const shapes: string[] = [];
    let made = 0;
    for (let f = 0; f < frames && made < n; f++, made++) {
      put(`f${f}`, {
        type: "frame",
        x: f * 2000,
        y: -3000,
        w: 1600,
        h: 1200,
        parentId: null,
        z: keys[made],
        name: `Frame ${f}`,
        fill: "card",
      });
    }
    for (let i = 0; made < n; i++, made++) {
      const id = `e${i}`;
      const r = next();
      const inFrame = r < 0.2;
      const parentId = inFrame ? `f${Math.floor(next() * frames)}` : null;
      const base = {
        x: Math.round(next() * 40000 - 20000),
        y: Math.round(next() * 40000 - 20000),
        w: 100 + Math.round(next() * 200),
        h: 100 + Math.round(next() * 200),
        parentId,
        z: keys[made],
        name: null,
      };
      const kind = next();
      if (kind < 0.4) {
        put(id, { ...base, type: "block", columnId: i });
      } else if (kind < 0.6) {
        put(id, {
          ...base,
          type: "rect",
          stroke: "foreground",
          fill: "none",
          width: 2,
          opacity: 1,
        });
        shapes.push(id);
      } else if (kind < 0.8) {
        const pts: number[] = [];
        for (let k = 0; k < 150; k++) pts.push(k * 2, Math.round(next() * 100), 0.5);
        put(id, {
          ...base,
          type: "stroke",
          points: pts,
          stroke: "foreground",
          width: 2,
          kind: "pen",
        });
      } else if (kind < 0.9 && shapes.length >= 2) {
        const a = shapes[Math.floor(next() * shapes.length)];
        const b = shapes[Math.floor(next() * shapes.length)];
        put(id, {
          ...base,
          parentId: null,
          type: "arrow",
          start: { kind: "bound", elementId: a, ax: 0.5, ay: 0.5 },
          end: { kind: "bound", elementId: b, ax: 0.5, ay: 0.5 },
          stroke: "foreground",
          width: 2,
          routing: "straight",
          startHead: "none",
          endHead: "arrow",
        });
      } else {
        put(id, { ...base, type: "sticky", text: new Y.Text("note"), fill: "yellow" });
      }
    }
  });
  return doc;
}
