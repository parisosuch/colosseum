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
});
