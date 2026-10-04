import { describe, expect, test } from "bun:test";

import { snapPoint, snapRect } from "./snapping";

describe("snapping", () => {
  const others = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 300, y: 0, w: 100, h: 100 },
  ];

  test("edges snap within the threshold and draw a guide", () => {
    const r = snapRect({ x: 103, y: 204, w: 50, h: 50 }, others, 6);
    expect(r.dx).toBe(-3);
    const line = r.guides.find((g) => g.kind === "line" && g.axis === "x");
    expect(line).toMatchObject({ kind: "line", axis: "x", at: 100 });
  });

  test("centres snap too", () => {
    const r = snapRect({ x: 23, y: 300, w: 50, h: 50 }, others, 6);
    expect(r.dx).toBe(2);
  });

  test("nothing within the threshold: no snap, no guides", () => {
    const r = snapRect({ x: 150, y: 300, w: 20, h: 20 }, others, 6);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  test("equal spacing between two neighbours, with the gap labelled", () => {
    // 100..300 leaves 200; a 100-wide box is centred at 150..250.
    const r = snapRect({ x: 147, y: 0, w: 100, h: 100 }, others, 6);
    expect(r.dx).toBe(3);
    const gaps = r.guides.filter((g) => g.kind === "gap");
    expect(gaps.map((g) => g.kind === "gap" && g.size)).toEqual([50, 50]);
  });

  test("equal spacing continues a neighbouring pair's gap", () => {
    const row = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 150, y: 0, w: 100, h: 100 },
    ];
    const r = snapRect({ x: 302, y: 0, w: 100, h: 100 }, row, 6);
    expect(r.dx).toBe(-2);
    expect(r.guides.some((g) => g.kind === "gap" && g.size === 50)).toBe(true);
  });

  test("points snap to edges and centres only", () => {
    expect(snapPoint({ x: 98, y: 52 }, others, 6)).toMatchObject({ dx: 2, dy: -2 });
  });

  describe("with the grid", () => {
    test("an edge within the threshold lands on the nearest grid line, drawn dashed", () => {
      // x: the left edge is 3 from 32. y: the top edge is 2 from 64.
      const r = snapRect({ x: 35, y: 66, w: 40, h: 20 }, [], 6, { grid: 16 });
      expect(r.dx).toBe(-3);
      expect(r.dy).toBe(-2);
      // Each caught line runs two steps past the box, with a mark at each
      // corner on it, and the label gives the top-left.
      expect(r.guides).toEqual([
        { kind: "grid", axis: "x", at: 32, from: 32, to: 116, marks: [64, 84] },
        { kind: "grid", axis: "y", at: 64, from: 0, to: 104, marks: [32, 72] },
        { kind: "position", x: 32, y: 64 },
      ]);
    });

    test("the right or bottom edge can be the one caught", () => {
      // The left edge is 5 from 16, the right edge 1 from 64.
      const r = snapRect({ x: 21, y: 64, w: 42, h: 16 }, [], 6, { grid: 16 });
      expect(r.dx).toBe(1);
      expect(r.guides).toContainEqual(expect.objectContaining({ kind: "grid", axis: "x", at: 64 }));
    });

    test("nothing within the threshold: no snap", () => {
      const r = snapRect({ x: 70, y: 1000, w: 10, h: 10 }, [], 6, { grid: 128 });
      expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
    });

    test("an element guide wins when it's closer, and only it draws", () => {
      // The design's case: the left edge is 3 from the first box's right edge
      // and the right edge 5 from a grid line at 160.
      const r = snapRect({ x: 103, y: 300, w: 52, h: 50 }, others, 6, { grid: 16 });
      expect(r.dx).toBe(-3);
      expect(r.guides).toContainEqual(
        expect.objectContaining({ kind: "line", axis: "x", at: 100 }),
      );
      expect(r.guides.some((g) => g.kind === "grid" && g.axis === "x")).toBe(false);
      // y has no element nearby, so the grid takes it.
      expect(r.dy).toBe(2);
    });

    test("the grid wins when it's closer than the element guide", () => {
      // 5 from the edge at 100, 1 from the grid line at 104.
      const r = snapRect({ x: 105, y: 304, w: 50, h: 50 }, others, 6, { grid: 8 });
      expect(r.dx).toBe(-1);
      expect(r.guides.some((g) => g.kind === "line" && g.axis === "x")).toBe(false);
      expect(r.guides).toContainEqual(
        expect.objectContaining({ kind: "grid", axis: "x", at: 104 }),
      );
    });

    test("points (resize handles, a shape's corners) snap to it; a tie goes to the element", () => {
      expect(snapPoint({ x: 203, y: 213 }, [], 6, { grid: 16 })).toMatchObject({ dx: 5, dy: -5 });
      // 2 from the second box's left edge and 2 from the grid line at 296.
      expect(snapPoint({ x: 298, y: 213 }, others, 6, { grid: 8 })).toMatchObject({
        dx: 2,
        dy: 3,
      });
    });

    test("no grid, no change", () => {
      expect(snapRect({ x: 35, y: 66, w: 40, h: 20 }, [], 6, { grid: null })).toEqual({
        dx: 0,
        dy: 0,
        guides: [],
      });
    });
  });
});
