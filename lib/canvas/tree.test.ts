import { describe, expect, test } from "bun:test";

import { paintOrder } from "./elements";
import { docWith, ORIGIN, state } from "./test-doc";
import {
  groupElements,
  childIds,
  rowWindow,
  layerRows,
  moveTo,
  reorder,
  reparentAfterMove,
  ungroupElements,
} from "./tree";

function worldOf(doc: ReturnType<typeof docWith>, id: string) {
  return state(doc).layout.geom.get(id)!.rect;
}

describe("groups", () => {
  const scene = () =>
    docWith({
      a: { type: "rect", x: 10, y: 20, w: 50, h: 50 },
      b: { type: "rect", x: 200, y: 100, w: 50, h: 50 },
      c: { type: "rect", x: 500, y: 500, w: 10, h: 10 },
      arrow: {
        type: "arrow",
        start: { kind: "point", x: 0, y: 0 },
        end: { kind: "bound", elementId: "b", ax: 0.5, ay: 0.5 },
        width: 2,
      },
    });

  test("grouping keeps everything where it is and takes the top member's place", () => {
    const doc = scene();
    const before = ["a", "b", "arrow"].map((id) => worldOf(doc, id));
    const g = groupElements(doc, ["a", "b", "arrow"], state(doc).layout, "u", ORIGIN)!;
    const { all, layout } = state(doc);
    expect(all.get(g)).toMatchObject({ type: "group", x: 0, y: 0, parentId: null });
    expect(["a", "b", "arrow"].map((id) => all.get(id)!.parentId)).toEqual([g, g, g]);
    expect(["a", "b", "arrow"].map((id) => layout.geom.get(id)!.rect)).toEqual(before);
    expect(layout.geom.get(g)!.rect).toEqual({ x: 0, y: 0, w: 250, h: 150 });
    // The group sits where the arrow (the top member) was: above c.
    expect(paintOrder(all).map((e) => e.id)).toEqual(["c", g, "a", "b", "arrow"]);
  });

  test("ungrouping puts the children back in the group's place in the stack", () => {
    const doc = scene();
    const g = groupElements(doc, ["a", "b"], state(doc).layout, "u", ORIGIN)!;
    const kids = ungroupElements(doc, [g], ORIGIN);
    const { all } = state(doc);
    expect(kids.sort()).toEqual(["a", "b"]);
    expect(all.has(g)).toBe(false);
    expect(all.get("a")).toMatchObject({ x: 10, y: 20, parentId: null });
    expect(paintOrder(all).map((e) => e.id)).toEqual(["a", "b", "c", "arrow"]);
  });

  test("groups nest and can sit inside frames", () => {
    const doc = docWith({
      f: { type: "frame", x: 100, y: 100, w: 400, h: 400 },
      a: { type: "rect", x: 10, y: 10, w: 10, h: 10, parentId: "f" },
      b: { type: "rect", x: 50, y: 50, w: 10, h: 10, parentId: "f" },
    });
    const inner = groupElements(doc, ["a", "b"], state(doc).layout, "u", ORIGIN)!;
    expect(state(doc).all.get(inner)!.parentId).toBe("f");
    const outer = groupElements(doc, [inner], state(doc).layout, "u", ORIGIN)!;
    expect(state(doc).all.get(inner)!.parentId).toBe(outer);
    expect(worldOf(doc, "a")).toEqual({ x: 110, y: 110, w: 10, h: 10 });
  });
});

describe("frames", () => {
  test("dropping into a frame re-parents without moving, and dragging out un-parents", () => {
    const doc = docWith({
      f: { type: "frame", x: 100, y: 100, w: 300, h: 300 },
      a: { type: "rect", x: 150, y: 150, w: 20, h: 20 },
    });
    expect(reparentAfterMove(doc, ["a"], state(doc).layout, { x: 160, y: 160 }, ORIGIN)).toBe(true);
    expect(state(doc).all.get("a")).toMatchObject({ parentId: "f", x: 50, y: 50 });
    expect(worldOf(doc, "a")).toEqual({ x: 150, y: 150, w: 20, h: 20 });
    expect(reparentAfterMove(doc, ["a"], state(doc).layout, { x: 900, y: 900 }, ORIGIN)).toBe(true);
    expect(state(doc).all.get("a")).toMatchObject({ parentId: null, x: 150, y: 150 });
  });

  test("an element can't be moved into itself", () => {
    const doc = docWith({
      f: { type: "frame", x: 0, y: 0, w: 300, h: 300 },
      g: { type: "frame", x: 10, y: 10, w: 100, h: 100, parentId: "f" },
    });
    moveTo(doc, ["f"], "g", ORIGIN);
    expect(state(doc).all.get("f")!.parentId).toBeNull();
  });
});

describe("layer order", () => {
  const scene = () =>
    docWith({
      a: { type: "rect", w: 1, h: 1 },
      b: { type: "rect", w: 1, h: 1 },
      c: { type: "rect", w: 1, h: 1 },
      d: { type: "rect", w: 1, h: 1 },
    });
  const order = (doc: ReturnType<typeof scene>) =>
    paintOrder(state(doc).all)
      .map((e) => e.id)
      .join("");

  test("forward, backward, front and back", () => {
    const doc = scene();
    reorder(doc, ["a"], "forward", ORIGIN);
    expect(order(doc)).toBe("bacd");
    reorder(doc, ["a"], "front", ORIGIN);
    expect(order(doc)).toBe("bcda");
    reorder(doc, ["a", "c"], "backward", ORIGIN);
    expect(order(doc)).toBe("cbad");
    reorder(doc, ["d"], "back", ORIGIN);
    expect(order(doc)).toBe("dcba");
  });

  test("only the elements that move get new keys", () => {
    const doc = scene();
    const before = state(doc).all;
    reorder(doc, ["a"], "front", ORIGIN);
    const after = state(doc).all;
    expect(["b", "c", "d"].every((id) => after.get(id)!.z === before.get(id)!.z)).toBe(true);
  });

  test("the Layers panel lists the top of the stack first, children under their parent", () => {
    const doc = docWith({
      a: { type: "rect", w: 1, h: 1 },
      f: { type: "frame", w: 100, h: 100 },
      k1: { type: "rect", w: 1, h: 1, parentId: "f" },
      k2: { type: "rect", w: 1, h: 1, parentId: "f" },
    });
    expect(layerRows(childIds(state(doc).all)).map((r) => `${r.depth}${r.id}`)).toEqual([
      "0f",
      "1k2",
      "1k1",
      "0a",
    ]);
  });

  test("moving a layer above a sibling inside another parent", () => {
    const doc = docWith({
      a: { type: "rect", x: 5, y: 5, w: 1, h: 1 },
      f: { type: "frame", x: 100, y: 100, w: 100, h: 100 },
      k1: { type: "rect", w: 1, h: 1, parentId: "f" },
      k2: { type: "rect", w: 1, h: 1, parentId: "f" },
    });
    moveTo(doc, ["a"], "f", ORIGIN, { id: "k1", where: "above" });
    const { all } = state(doc);
    expect(all.get("a")).toMatchObject({ parentId: "f", x: -95, y: -95 });
    expect(layerRows(childIds(all)).map((r) => r.id)).toEqual(["f", "k2", "a", "k1"]);
  });
});

describe("rowWindow", () => {
  test("renders the rows in view plus the overscan, clamped to the list", () => {
    expect(rowWindow(0, 280, 5000, 28, 8)).toEqual({ first: 0, last: 18 });
    expect(rowWindow(28 * 1000, 280, 5000, 28, 8)).toEqual({ first: 992, last: 1018 });
    expect(rowWindow(28 * 4995, 280, 5000, 28, 8)).toEqual({ first: 4987, last: 5000 });
    expect(rowWindow(0, 280, 0, 28)).toEqual({ first: 0, last: 0 });
  });
});
