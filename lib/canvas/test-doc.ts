// Helpers for the canvas logic tests: a doc with elements written straight
// in, and its snapshot and layout.

import * as Y from "yjs";

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
