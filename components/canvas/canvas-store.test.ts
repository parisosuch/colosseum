import { expect, test } from "bun:test";
import * as Y from "yjs";

import { DocIndex, type DocState } from "@/lib/canvas/doc-state";
import { setGeometry } from "@/lib/canvas/elements";
import { bigBoard } from "@/lib/canvas/test-doc";
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

// --- incremental doc state ---

function plain(s: DocState) {
  const sorted = <V>(m: ReadonlyMap<string, V>) =>
    [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    elements: sorted(s.elements),
    ordered: s.ordered.map((e) => e.id),
    boxes: s.boxes.map((b) => [b.id, b.rect]),
    boxById: sorted(s.boxById).map(([id, b]) => [id, b.rect]),
    placed: [...s.placed].sort((a, b) => a - b),
    geom: sorted(s.layout.geom),
    ends: sorted(s.layout.ends),
    children: [...s.children.entries()]
      .map(([p, ids]) => [p ?? "", [...ids]] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
    frames: s.frames.map((e) => e.id),
  };
}

// The state the store kept up to date, against one built from scratch, after
// every transaction of a long random edit session: moves, resizes, hiding,
// restacking, reparenting (cycles and missing parents included), deleting a
// parent without its children, adding, rebinding lines and typing.
test("incremental updates agree with a rebuild through random edits", () => {
  const store = new CanvasStore(1, "write", "u");
  Y.applyUpdate(store.doc, Y.encodeStateAsUpdate(bigBoard(200)));
  const map = elementsOf(store.doc);
  let seed = 7;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  let fresh = 0;
  const containers = () =>
    [...map.entries()]
      .filter(([, m]) => m.get("type") === "frame" || m.get("type") === "group")
      .map(([id]) => id);

  for (let step = 0; step < 1000; step++) {
    const ids = [...map.keys()];
    const id = pick(ids);
    const el = map.get(id)!;
    const op = Math.floor(rand() * 12);
    store.doc.transact(() => {
      switch (op) {
        case 0:
          el.set("x", Math.round(rand() * 2000 - 1000));
          el.set("y", Math.round(rand() * 2000 - 1000));
          break;
        case 1:
          el.set("w", Math.round(rand() * 300));
          break;
        case 2:
          el.set("hidden", !el.get("hidden"));
          break;
        case 3:
          el.set("z", (map.get(pick(ids))!.get("z") as string) ?? "i00000");
          break;
        case 4: {
          const c = containers();
          el.set("parentId", rand() < 0.3 || c.length === 0 ? null : pick(c));
          break;
        }
        case 5:
          map.delete(id);
          break;
        case 6: {
          const type = pick(["rect", "frame", "group", "block"] as const);
          const m = new Y.Map<unknown>();
          m.set("type", type);
          m.set("x", Math.round(rand() * 1000));
          m.set("y", Math.round(rand() * 1000));
          m.set("w", 50);
          m.set("h", 50);
          m.set("z", "i00000");
          m.set("parentId", rand() < 0.5 ? null : pick(ids));
          if (type === "block") m.set("columnId", Math.floor(rand() * 20));
          map.set(`n${fresh++}`, m);
          break;
        }
        case 7: {
          const m = new Y.Map<unknown>();
          m.set("type", "arrow");
          m.set("x", 0);
          m.set("y", 0);
          m.set("w", 0);
          m.set("h", 0);
          m.set("z", "i00000");
          m.set("parentId", rand() < 0.7 ? null : pick(ids));
          m.set("start", { kind: "bound", elementId: pick(ids), ax: 0.5, ay: 0.5 });
          m.set("end", { kind: "bound", elementId: pick(ids), ax: 0, ay: 1 });
          map.set(`n${fresh++}`, m);
          break;
        }
        case 8:
          if (el.get("type") === "arrow") {
            el.set("end", { kind: "bound", elementId: pick(ids), ax: 1, ay: 0 });
          } else {
            el.set("parentId", `missing-${step}`);
          }
          break;
        case 9: {
          // A whole frame and what's in it moves in one go, as a drag writes.
          const c = containers();
          if (c.length) map.get(pick(c))!.set("x", Math.round(rand() * 500));
          el.set("y", Math.round(rand() * 500));
          break;
        }
        case 10: {
          const t = el.get("text");
          if (t instanceof Y.Text) t.insert(0, "x");
          else el.set("name", `n${step}`);
          break;
        }
        case 11: {
          // Deleted and written back under the same id in one transaction.
          const copy = new Y.Map<unknown>();
          for (const [k, v] of el.entries()) if (!(v instanceof Y.AbstractType)) copy.set(k, v);
          map.delete(id);
          map.set(id, copy);
          break;
        }
      }
    }, store.origin);
    const expected = new DocIndex().rebuild(store.doc);
    expect(plain(store.docState)).toEqual(plain(expected));
  }
  store.destroy();
}, 60_000);

test("a write to one element keeps every other snapshot, box and Geom", () => {
  const store = new CanvasStore(1, "write", "u");
  Y.applyUpdate(store.doc, Y.encodeStateAsUpdate(bigBoard(300)));
  const before = store.docState;
  setGeometry(store.doc, [{ id: "e10", x: 12345 }], store.origin);
  const after = store.docState;
  expect(after.changed?.order).toBe(false);
  for (const [id, el] of before.elements) {
    if (id !== "e10") expect(after.elements.get(id)).toBe(el);
  }
  expect(after.elements.get("e10")!.x).toBe(12345);
  const moved = [...after.layout.geom].filter(([id, g]) => before.layout.geom.get(id) !== g);
  // Its own box, plus the lines bound to it.
  for (const [id] of moved) {
    expect(id === "e10" || after.elements.get(id)!.type === "arrow").toBe(true);
  }
  expect(after.children).toBe(before.children);
  store.destroy();
});

test("typing stops when the session drops to read-only", () => {
  const store = new CanvasStore(1, "write", "u");
  add(store, "a");
  store.setEditing({ id: "a" });
  // The server's session event, as the socket would deliver it.
  (store as unknown as { handleEvent: (e: unknown) => void }).handleEvent({
    type: "session",
    access: "read",
    user: { id: "u", name: "U", color: "blue", handle: "u" },
  });
  expect(store.canEdit).toBe(false);
  expect(store.editing).toBeNull();
  store.destroy();
});

test("a refused edit closes editing for good, with the server's reason", () => {
  const store = new CanvasStore(1, "write", "u");
  const handle = (e: unknown) =>
    (store as unknown as { handleEvent: (e: unknown) => void }).handleEvent(e);
  handle({ type: "edit.refused", reason: "doc-full" });
  expect(store.connection.closed).toBe("edit-refused");
  expect(store.connection.refused).toBe("doc-full");
  expect(store.canEdit).toBe(false);
  // A reason this client doesn't know reads as the common one.
  const other = new CanvasStore(1, "write", "u");
  (other as unknown as { handleEvent: (e: unknown) => void }).handleEvent({
    type: "edit.refused",
    reason: "something-new",
  });
  expect(other.connection.refused).toBe("too-large");
  store.destroy();
  other.destroy();
});
