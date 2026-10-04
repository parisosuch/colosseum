import { describe, expect, test } from "bun:test";

import { anchorFor, clipToOutline, headPath, route } from "./connectors";
import { removeElements, setGeometry } from "./elements";
import { moveUpdates, connectorBoxUpdates } from "./transform";
import { setProps } from "./elements";
import { docWith, ORIGIN, state } from "./test-doc";

describe("connectors", () => {
  test("a bound end stops at its element's outline, short by the gap", () => {
    const r = { x: 100, y: 0, w: 100, h: 100 };
    const p = clipToOutline("rect", r, { x: 0, y: 50 }, { x: 150, y: 50 }, 4);
    expect(p).toEqual({ x: 96, y: 50 });
    const e = clipToOutline("ellipse", r, { x: 0, y: 50 }, { x: 150, y: 50 }, 0);
    expect(e.x).toBeCloseTo(100);
    const d = clipToOutline("diamond", r, { x: 150, y: -100 }, { x: 150, y: 50 }, 0);
    expect(d).toEqual({ x: 150, y: 0 });
    // From inside the shape there's no outline to stop at.
    expect(clipToOutline("rect", r, { x: 120, y: 10 }, { x: 150, y: 50 })).toEqual({
      x: 150,
      y: 50,
    });
  });

  test("anchors are normalized and clamped", () => {
    expect(anchorFor({ x: 0, y: 0, w: 200, h: 100 }, { x: 50, y: 150 })).toEqual({
      ax: 0.25,
      ay: 1,
    });
  });

  test("elbow routes are orthogonal and leave from the facing side", () => {
    const pts = route(
      { kind: "bound", rect: { x: 0, y: 0, w: 100, h: 100 }, shape: "rect", ax: 0.5, ay: 0.5 },
      { kind: "point", at: { x: 400, y: 300 } },
      "elbow",
    );
    expect(pts[0]).toEqual({ x: 104, y: 50 });
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
    }
    expect(pts.at(-1)).toEqual({ x: 400, y: 300 });
  });

  test("arrowheads", () => {
    expect(headPath("none", { x: 10, y: 0 }, { x: 0, y: 0 }, 2)).toBeNull();
    expect(headPath("triangle", { x: 10, y: 0 }, { x: 0, y: 0 }, 2)?.fill).toBe(true);
    expect(headPath("arrow", { x: 10, y: 0 }, { x: 0, y: 0 }, 2)?.fill).toBe(false);
  });
});

describe("layout and binding", () => {
  const scene = () =>
    docWith({
      a: { type: "rect", x: 0, y: 0, w: 100, h: 100, fill: "none", stroke: "foreground", width: 2 },
      b: {
        type: "ellipse",
        x: 300,
        y: 0,
        w: 100,
        h: 100,
        fill: "none",
        stroke: "foreground",
        width: 2,
      },
      arrow: {
        type: "arrow",
        start: { kind: "bound", elementId: "a", ax: 0.5, ay: 0.5 },
        end: { kind: "bound", elementId: "b", ax: 0.5, ay: 0.5 },
        width: 2,
        routing: "straight",
        startHead: "none",
        endHead: "arrow",
      },
    });

  test("a bound arrow runs between its elements' outlines", () => {
    const { layout } = state(scene());
    const route = layout.geom.get("arrow")!.route!;
    expect(route[0].x).toBeCloseTo(104);
    expect(route[0].y).toBeCloseTo(50);
    expect(route[1].x).toBeCloseTo(296);
    expect(route[1].y).toBeCloseTo(50);
  });

  test("bound ends follow their elements through moves and resizes", () => {
    const doc = scene();
    setGeometry(doc, [{ id: "b", x: 300, y: 400 }], ORIGIN);
    let route = state(doc).layout.geom.get("arrow")!.route!;
    expect(route[1].y).toBeGreaterThan(390);
    setGeometry(doc, [{ id: "a", w: 200, h: 200 }], ORIGIN);
    route = state(doc).layout.geom.get("arrow")!.route!;
    // The anchor stays the middle of a's new box.
    const dx = route[1].x - 100;
    const dy = route[1].y - 100;
    const sx = route[0].x - 100;
    const sy = route[0].y - 100;
    expect(Math.abs(dx * sy - dy * sx)).toBeLessThan(1);
  });

  test("a bound arrow follows an element inside a moved frame", () => {
    const doc = docWith({
      f: { type: "frame", x: 0, y: 0, w: 500, h: 500, fill: "card" },
      a: { type: "rect", x: 10, y: 10, w: 100, h: 100, parentId: "f", fill: "yellow" },
      arrow: {
        type: "arrow",
        start: { kind: "point", x: 800, y: 260 },
        end: { kind: "bound", elementId: "a", ax: 0.5, ay: 0.5 },
        width: 2,
      },
    });
    setGeometry(doc, [{ id: "f", x: 0, y: 200 }], ORIGIN);
    const route = state(doc).layout.geom.get("arrow")!.route!;
    expect(route[1].x).toBeCloseTo(114);
    expect(route[1].y).toBeCloseTo(260);
  });

  test("moving an arrow on its own frees ends bound to elements that stay", () => {
    const doc = scene();
    const { all, layout } = state(doc);
    setProps(doc, moveUpdates(all, ["arrow"], 0, 50, layout), ORIGIN);
    const after = state(doc).all.get("arrow")!;
    expect(after.start).toEqual({ kind: "point", x: 104, y: 100 });
    expect(after.end?.kind).toBe("point");
  });

  test("moving an arrow with both its elements keeps the bindings", () => {
    const doc = scene();
    const { all, layout } = state(doc);
    setProps(doc, moveUpdates(all, ["a", "b", "arrow"], 10, 10, layout), ORIGIN);
    const after = state(doc).all.get("arrow")!;
    expect(after.start?.kind).toBe("bound");
    expect(after.end?.kind).toBe("bound");
  });

  test("deleting a bound element leaves the end where it was drawn", () => {
    const doc = scene();
    const { layout } = state(doc);
    removeElements(doc, ["b"], ORIGIN, layout.ends);
    const after = state(doc);
    expect(after.all.get("arrow")!.end).toEqual({ kind: "point", x: 296, y: 50 });
    expect(after.layout.geom.get("arrow")!.route![1]).toEqual({ x: 296, y: 50 });
  });

  test("connector boxes are written back after a gesture", () => {
    const doc = scene();
    const { all, layout } = state(doc);
    const updates = connectorBoxUpdates(all, layout);
    expect(updates).toHaveLength(1);
    setProps(doc, updates, ORIGIN);
    const s = state(doc);
    expect(s.all.get("arrow")).toMatchObject({ x: 104, y: 50, w: 192 });
    expect(connectorBoxUpdates(s.all, s.layout)).toHaveLength(0);
  });

  test("groups take their children's bounds; frames clip their children", () => {
    const doc = docWith({
      f: { type: "frame", x: 100, y: 100, w: 200, h: 200, fill: "card" },
      g: { type: "group", x: 10, y: 10, parentId: "f" },
      k1: { type: "rect", x: 0, y: 0, w: 50, h: 50, parentId: "g" },
      k2: { type: "rect", x: 100, y: 250, w: 50, h: 50, parentId: "g" },
    });
    const { layout } = state(doc);
    expect(layout.geom.get("g")!.rect).toEqual({ x: 110, y: 110, w: 150, h: 300 });
    expect(layout.geom.get("k2")!.clip).toEqual({ x: 100, y: 100, w: 200, h: 200 });
    expect(layout.geom.get("f")!.clip).toBeNull();
  });
});
