import { expect, test } from "bun:test";
import * as Y from "yjs";

import { elementsOf } from "@/lib/realtime/canvas-doc";
import { CanvasStore } from "./canvas-store";

function add(store: CanvasStore, id: string) {
  store.doc.transact(() => {
    const el = new Y.Map<unknown>();
    el.set("type", "rect");
    elementsOf(store.doc).set(id, el);
  }, store.origin);
  store.undo.stopCapturing();
}

// The page's effect disconnects on cleanup and connects again when React
// re-runs it on the same store; edits after that must still be undoable.
test("disconnect keeps the doc and the undo history", () => {
  const store = new CanvasStore(1, "write", "u");
  add(store, "a");
  store.disconnect();
  add(store, "b");
  expect(store.history).toEqual({ canUndo: true, canRedo: false });
  store.undo.undo();
  expect(elementsOf(store.doc).has("b")).toBe(false);
  store.undo.undo();
  expect(elementsOf(store.doc).has("a")).toBe(false);
  expect(store.history.canRedo).toBe(true);
  store.destroy();
});
