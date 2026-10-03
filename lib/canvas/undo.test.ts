import { describe, expect, test } from "bun:test";
import * as Y from "yjs";

import { createElement, readElements, setGeometry } from "./elements";
import { createUndoManager } from "./undo";

// Two clients kept in sync the way the server relays updates.
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "remote") Y.applyUpdate(b, u, "remote");
  });
  b.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "remote") Y.applyUpdate(a, u, "remote");
  });
  return { a, b };
}

describe("undo per person", () => {
  test("an undo reverts only this client's edits", () => {
    const { a, b } = pair();
    const ua = Symbol("a");
    const ub = Symbol("b");
    const undoA = createUndoManager(a, ua);
    createUndoManager(b, ub);
    const mine = createElement(a, { type: "rect", x: 0, y: 0, w: 10, h: 10, createdBy: "a" }, ua);
    undoA.stopCapturing();
    const theirs = createElement(
      b,
      { type: "rect", x: 50, y: 50, w: 10, h: 10, createdBy: "b" },
      ub,
    );
    undoA.undo();
    expect(readElements(a).has(mine)).toBe(false);
    expect(readElements(a).has(theirs)).toBe(true);
    expect(readElements(b).has(theirs)).toBe(true);
    undoA.redo();
    expect(readElements(b).has(mine)).toBe(true);
  });

  test("on one element, my undo reverts my field and keeps theirs", () => {
    const { a, b } = pair();
    const ua = Symbol("a");
    const ub = Symbol("b");
    const id = createElement(a, { type: "rect", x: 0, y: 0, w: 10, h: 10, createdBy: "a" }, ua);
    const undoA = createUndoManager(a, ua);
    setGeometry(a, [{ id, x: 100 }], ua);
    setGeometry(b, [{ id, w: 500 }], ub);
    undoA.undo();
    expect(readElements(b).get(id)).toMatchObject({ x: 0, w: 500 });
  });

  test("a drag's writes are one undo step", () => {
    const doc = new Y.Doc();
    const o = Symbol("me");
    const id = createElement(doc, { type: "rect", x: 0, y: 0, w: 10, h: 10, createdBy: "a" }, o);
    const undo = createUndoManager(doc, o);
    for (let x = 1; x <= 30; x++) setGeometry(doc, [{ id, x }], o);
    undo.undo();
    expect(readElements(doc).get(id)!.x).toBe(0);
  });
});
