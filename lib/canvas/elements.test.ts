import { describe, expect, test } from "bun:test";
import * as Y from "yjs";

import { elementsOf } from "@/lib/realtime/canvas-doc";
import {
  BLOCK_DEFAULT_SIZE,
  boxesOf,
  paintOrder,
  placeBlock,
  placedColumns,
  readElements,
  removeElements,
  setGeometry,
  topZ,
  worldRect,
} from "./elements";

const origin = Symbol("test");

function addRaw(doc: Y.Doc, id: string, fields: Record<string, unknown>) {
  const el = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) el.set(k, v);
  elementsOf(doc).set(id, el);
}

describe("canvas elements", () => {
  test("placing a block centres it on the drop point and stacks it on top", () => {
    const doc = new Y.Doc();
    const a = placeBlock(doc, { columnId: 1, at: { x: 0, y: 0 }, createdBy: "u" }, origin);
    const b = placeBlock(doc, { columnId: 2, at: { x: 500, y: 500 }, createdBy: "u" }, origin);
    const all = readElements(doc);
    const ea = all.get(a)!;
    expect(ea.type).toBe("block");
    expect(ea.columnId).toBe(1);
    expect(ea.w).toBe(BLOCK_DEFAULT_SIZE.w);
    expect(ea.x + ea.w / 2).toBe(0);
    expect(all.get(b)!.z > ea.z).toBe(true);
    expect(paintOrder(all, new Set(["block"])).map((e) => e.id)).toEqual([a, b]);
    expect(placedColumns(all)).toEqual(new Set([1, 2]));
  });

  test("writes carry the given origin", () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    const id = placeBlock(doc, { columnId: 1, at: { x: 0, y: 0 }, createdBy: "u" }, origin);
    setGeometry(doc, [{ id, x: 10.4, y: 20.6 }], origin);
    removeElements(doc, [id], origin);
    expect(origins).toEqual([origin, origin, origin]);
  });

  test("geometry is rounded, unknown ids skipped, unchanged keys not rewritten", () => {
    const doc = new Y.Doc();
    const id = placeBlock(doc, { columnId: 1, at: { x: 0, y: 0 }, createdBy: "u" }, origin);
    setGeometry(
      doc,
      [
        { id, x: 10.4, w: 300.6 },
        { id: "gone", x: 1 },
      ],
      origin,
    );
    const el = readElements(doc).get(id)!;
    expect(el.x).toBe(10);
    expect(el.w).toBe(301);
    let updates = 0;
    doc.on("update", () => updates++);
    setGeometry(doc, [{ id, x: 10, w: 301 }], origin);
    expect(updates).toBe(0);
  });

  test("unchanged elements keep their snapshot object", () => {
    const doc = new Y.Doc();
    const a = placeBlock(doc, { columnId: 1, at: { x: 0, y: 0 }, createdBy: "u" }, origin);
    const b = placeBlock(doc, { columnId: 2, at: { x: 0, y: 0 }, createdBy: "u" }, origin);
    const first = readElements(doc);
    setGeometry(doc, [{ id: b, x: 99 }], origin);
    const second = readElements(doc, first);
    expect(second.get(a)).toBe(first.get(a));
    expect(second.get(b)).not.toBe(first.get(b));
  });

  test("world rects follow the parent chain and survive cycles and orphans", () => {
    const doc = new Y.Doc();
    addRaw(doc, "frame", {
      type: "frame",
      x: 100,
      y: 100,
      w: 500,
      h: 500,
      parentId: null,
      z: "i00000",
    });
    addRaw(doc, "group", {
      type: "group",
      x: 10,
      y: 10,
      w: 0,
      h: 0,
      parentId: "frame",
      z: "i00000",
    });
    addRaw(doc, "kid", {
      type: "block",
      columnId: 3,
      x: 5,
      y: 5,
      w: 50,
      h: 50,
      parentId: "group",
      z: "i00000",
    });
    addRaw(doc, "orphan", {
      type: "block",
      columnId: 4,
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      parentId: "nope",
      z: "i00000",
    });
    addRaw(doc, "loopA", {
      type: "block",
      columnId: 5,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      parentId: "loopB",
      z: "i00000",
    });
    addRaw(doc, "loopB", { type: "group", x: 0, y: 0, w: 1, h: 1, parentId: "loopA", z: "i00000" });
    const all = readElements(doc);
    expect(worldRect(all.get("kid")!, all)).toEqual({ x: 115, y: 115, w: 50, h: 50 });
    expect(worldRect(all.get("orphan")!, all)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(worldRect(all.get("loopA")!, all)).toBeNull();
    const order = paintOrder(all, new Set(["block"]));
    // Children paint after their parents; the cycle never reaches the top.
    expect(order.map((e) => e.id)).toEqual(["kid", "orphan"]);
    expect(boxesOf(order, all).map((b) => b.id)).toEqual(["kid", "orphan"]);
  });

  test("hidden elements are not painted, and malformed ones are skipped", () => {
    const doc = new Y.Doc();
    addRaw(doc, "h", {
      type: "block",
      columnId: 1,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      parentId: null,
      z: "i00000",
      hidden: true,
    });
    addRaw(doc, "bad", { x: 0 });
    addRaw(doc, "nan", {
      type: "block",
      columnId: 2,
      x: Number.NaN,
      y: 0,
      w: -5,
      h: 1,
      parentId: null,
      z: "i00001",
    });
    const all = readElements(doc);
    expect(all.has("bad")).toBe(false);
    expect(all.get("nan")).toMatchObject({ x: 0, w: 0 });
    expect(paintOrder(all, new Set(["block"])).map((e) => e.id)).toEqual(["nan"]);
  });

  test("top z only looks at the top level", () => {
    const doc = new Y.Doc();
    addRaw(doc, "a", {
      type: "block",
      columnId: 1,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      parentId: null,
      z: "i00000",
    });
    addRaw(doc, "b", {
      type: "block",
      columnId: 1,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      parentId: "a",
      z: "z00000",
    });
    expect(topZ(readElements(doc)) > "i00000").toBe(true);
    expect(topZ(readElements(doc)) < "z00000").toBe(true);
  });
});
