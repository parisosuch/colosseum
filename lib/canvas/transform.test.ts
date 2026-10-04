import { describe, expect, test } from "bun:test";

import { setProps } from "./elements";
import { docWith, ORIGIN, state } from "./test-doc";
import { alignUpdates, distributeUpdates, moveUpdates, resizeUpdates } from "./transform";

describe("move and resize", () => {
  test("moving a frame moves what's in it", () => {
    const doc = docWith({
      f: { type: "frame", x: 0, y: 0, w: 100, h: 100 },
      k: { type: "rect", x: 10, y: 10, w: 10, h: 10, parentId: "f" },
    });
    const { all, layout } = state(doc);
    setProps(doc, moveUpdates(all, ["f", "k"], 50, 0, layout), ORIGIN);
    const after = state(doc);
    expect(after.all.get("k")).toMatchObject({ x: 10, y: 10 });
    expect(after.layout.geom.get("k")!.rect.x).toBe(60);
  });

  test("locked elements don't move", () => {
    const doc = docWith({ a: { type: "rect", w: 10, h: 10, locked: true } });
    const { all, layout } = state(doc);
    expect(moveUpdates(all, ["a"], 5, 5, layout)).toEqual([]);
  });

  test("resizing a frame keeps its children where they are", () => {
    const doc = docWith({
      f: { type: "frame", x: 100, y: 100, w: 100, h: 100 },
      k: { type: "rect", x: 10, y: 10, w: 10, h: 10, parentId: "f" },
    });
    const { all, layout } = state(doc);
    const from = layout.geom.get("f")!.rect;
    setProps(
      doc,
      resizeUpdates(all, ["f"], layout, from, { x: 50, y: 50, w: 150, h: 150 }),
      ORIGIN,
    );
    const after = state(doc);
    expect(after.all.get("f")).toMatchObject({ x: 50, y: 50, w: 150, h: 150 });
    expect(after.layout.geom.get("k")!.rect).toEqual({ x: 110, y: 110, w: 10, h: 10 });
  });

  test("resizing a group scales its children, pen points and free line ends included", () => {
    const doc = docWith({
      g: { type: "group", x: 0, y: 0 },
      r: { type: "rect", x: 0, y: 0, w: 100, h: 100, parentId: "g" },
      s: {
        type: "stroke",
        x: 100,
        y: 100,
        w: 100,
        h: 100,
        points: [0, 0, 0.5, 100, 100, 0.5],
        parentId: "g",
      },
      l: {
        type: "line",
        start: { kind: "point", x: 0, y: 200 },
        end: { kind: "point", x: 200, y: 200 },
        parentId: "g",
      },
    });
    const { all, layout } = state(doc);
    const from = layout.geom.get("g")!.rect;
    expect(from).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    setProps(doc, resizeUpdates(all, ["g"], layout, from, { x: 0, y: 0, w: 400, h: 100 }), ORIGIN);
    const after = state(doc);
    expect(after.layout.geom.get("r")!.rect).toEqual({ x: 0, y: 0, w: 200, h: 50 });
    expect(after.all.get("s")!.points).toEqual([0, 0, 0.5, 200, 50, 0.5]);
    expect(after.all.get("l")!.end).toEqual({ kind: "point", x: 400, y: 100 });
  });

  test("resizing text by hand stops it autosizing", () => {
    const doc = docWith({ t: { type: "text", w: 50, h: 20, text: "hi", autoSize: true } });
    const { all, layout } = state(doc);
    setProps(
      doc,
      resizeUpdates(
        all,
        ["t"],
        layout,
        { x: 0, y: 0, w: 50, h: 20 },
        { x: 0, y: 0, w: 120, h: 20 },
      ),
      ORIGIN,
    );
    expect(state(doc).all.get("t")).toMatchObject({ w: 120, autoSize: false });
  });
});

describe("align and distribute", () => {
  const row = () =>
    docWith({
      a: { type: "rect", x: 0, y: 0, w: 10, h: 10 },
      b: { type: "rect", x: 30, y: 40, w: 20, h: 10 },
      c: { type: "rect", x: 100, y: 5, w: 10, h: 30 },
    });

  test("align to the selection's edges and centres", () => {
    const doc = row();
    let s = state(doc);
    setProps(doc, alignUpdates(s.all, ["a", "b", "c"], s.layout, "right"), ORIGIN);
    s = state(doc);
    expect(
      ["a", "b", "c"].map((id) => s.layout.geom.get(id)!.rect.x + s.layout.geom.get(id)!.rect.w),
    ).toEqual([110, 110, 110]);
    setProps(doc, alignUpdates(s.all, ["a", "b", "c"], s.layout, "vcenter"), ORIGIN);
    s = state(doc);
    expect(
      ["a", "b", "c"].map(
        (id) => s.layout.geom.get(id)!.rect.y + s.layout.geom.get(id)!.rect.h / 2,
      ),
    ).toEqual([25, 25, 25]);
  });

  test("a single element aligns to its frame", () => {
    const doc = docWith({
      f: { type: "frame", x: 100, y: 100, w: 200, h: 200 },
      k: { type: "rect", x: 20, y: 20, w: 10, h: 10, parentId: "f" },
    });
    const s = state(doc);
    setProps(doc, alignUpdates(s.all, ["k"], s.layout, "hcenter"), ORIGIN);
    expect(state(doc).all.get("k")!.x).toBe(95);
  });

  test("distribute leaves equal gaps and keeps the outer two", () => {
    const doc = row();
    const s = state(doc);
    setProps(doc, distributeUpdates(s.all, ["a", "b", "c"], s.layout, "x"), ORIGIN);
    const all = state(doc).all;
    // Span 0..110, 40 of boxes, two gaps of 35.
    expect([all.get("a")!.x, all.get("b")!.x, all.get("c")!.x]).toEqual([0, 45, 100]);
  });
});
