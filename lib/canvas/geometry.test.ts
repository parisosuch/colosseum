import { describe, expect, test } from "bun:test";

import {
  cullBoxes,
  hitHandle,
  hitTest,
  marqueeHits,
  needsRecull,
  normalizeRect,
  nudgeDelta,
  pastThreshold,
  resizeRect,
  scaleRects,
  unionRects,
  type Box,
} from "./geometry";

const boxes: Box[] = [
  { id: "a", rect: { x: 0, y: 0, w: 100, h: 100 } },
  { id: "b", rect: { x: 50, y: 50, w: 100, h: 100 } },
  { id: "c", rect: { x: 500, y: 500, w: 10, h: 10 } },
];

describe("hit-testing", () => {
  test("topmost box wins where boxes overlap", () => {
    expect(hitTest(boxes, { x: 75, y: 75 })).toBe("b");
    expect(hitTest(boxes, { x: 10, y: 10 })).toBe("a");
    expect(hitTest(boxes, { x: 300, y: 300 })).toBeNull();
  });

  test("edges count as inside", () => {
    expect(hitTest(boxes, { x: 0, y: 0 })).toBe("a");
    expect(hitTest(boxes, { x: 510, y: 510 })).toBe("c");
  });
});

describe("marquee", () => {
  test("normalizes a drag in any direction", () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, w: 10, h: 15 });
  });

  test("selects every box it touches, not only the ones it contains", () => {
    expect(marqueeHits(boxes, { x: 90, y: 90, w: 5, h: 5 }).sort()).toEqual(["a", "b"]);
    expect(marqueeHits(boxes, { x: 140, y: 140, w: 400, h: 400 }).sort()).toEqual(["b", "c"]);
    expect(marqueeHits(boxes, { x: 200, y: 0, w: 50, h: 50 })).toEqual([]);
  });

  test("union of rects", () => {
    expect(unionRects(boxes.map((b) => b.rect))).toEqual({ x: 0, y: 0, w: 510, h: 510 });
    expect(unionRects([])).toBeNull();
  });
});

describe("culling", () => {
  test("keeps what's in view plus the margin", () => {
    const view = { x: 0, y: 0, w: 200, h: 200 };
    expect([...cullBoxes(boxes, view, 0)].sort()).toEqual(["a", "b"]);
    expect([...cullBoxes(boxes, view, 300)].sort()).toEqual(["a", "b", "c"]);
  });

  test("500 blocks on a grid: only the neighbourhood of the view is kept", () => {
    const grid: Box[] = [];
    for (let i = 0; i < 500; i++) {
      grid.push({
        id: String(i),
        rect: { x: (i % 25) * 300, y: Math.floor(i / 25) * 330, w: 256, h: 292 },
      });
    }
    const kept = cullBoxes(grid, { x: 0, y: 0, w: 1440, h: 900 }, 360);
    expect(kept.size).toBeGreaterThan(0);
    expect(kept.size).toBeLessThan(60);
  });

  test("recull only when the view nears the edge of what was culled", () => {
    const culledFor = { x: -500, y: -500, w: 2000, h: 2000 };
    expect(needsRecull(null, { x: 0, y: 0, w: 100, h: 100 }, 0)).toBe(true);
    expect(needsRecull(culledFor, { x: 0, y: 0, w: 1000, h: 1000 }, 100)).toBe(false);
    expect(needsRecull(culledFor, { x: 450, y: 0, w: 1000, h: 1000 }, 100)).toBe(true);
  });
});

describe("drag threshold", () => {
  test("3px separates a click from a drag", () => {
    const start = { x: 100, y: 100 };
    expect(pastThreshold(start, { x: 102, y: 102 })).toBe(false);
    expect(pastThreshold(start, { x: 103, y: 100 })).toBe(false);
    expect(pastThreshold(start, { x: 103, y: 101 })).toBe(true);
    expect(pastThreshold(start, { x: 90, y: 100 })).toBe(true);
  });
});

describe("resize", () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };

  test("handles hit within their radius", () => {
    expect(hitHandle(r, { x: 102, y: 97 }, 6)).toBe("nw");
    expect(hitHandle(r, { x: 300, y: 200 }, 6)).toBe("se");
    expect(hitHandle(r, { x: 200, y: 150 }, 6)).toBeNull();
  });

  test("the opposite corner stays put", () => {
    expect(resizeRect(r, "se", 50, 20)).toEqual({ x: 100, y: 100, w: 250, h: 120 });
    expect(resizeRect(r, "nw", 50, 20)).toEqual({ x: 150, y: 120, w: 150, h: 80 });
    expect(resizeRect(r, "ne", 10, -10)).toEqual({ x: 100, y: 90, w: 210, h: 110 });
    expect(resizeRect(r, "sw", -10, 10)).toEqual({ x: 90, y: 100, w: 210, h: 110 });
  });

  test("never below the minimum, and never flipped", () => {
    const out = resizeRect(r, "se", -1000, -1000, { min: { w: 64, h: 40 } });
    expect(out).toEqual({ x: 100, y: 100, w: 64, h: 40 });
    const nw = resizeRect(r, "nw", 1000, 1000, { min: { w: 64, h: 40 } });
    expect(nw).toEqual({ x: 236, y: 160, w: 64, h: 40 });
  });

  test("shift keeps the aspect ratio", () => {
    const out = resizeRect(r, "se", 100, 0, { keepAspect: true });
    expect(out.w / out.h).toBeCloseTo(2);
    expect(out.w).toBe(300);
    const small = resizeRect(r, "se", -190, 0, { keepAspect: true, min: { w: 40, h: 40 } });
    expect(small.w / small.h).toBeCloseTo(2);
    expect(small.h).toBeGreaterThanOrEqual(40);
  });

  test("multi-selection resize scales positions and sizes", () => {
    const from = { x: 0, y: 0, w: 100, h: 100 };
    const to = { x: 0, y: 0, w: 200, h: 50 };
    expect(
      scaleRects(
        [
          { x: 0, y: 0, w: 50, h: 50 },
          { x: 50, y: 50, w: 50, h: 50 },
        ],
        from,
        to,
      ),
    ).toEqual([
      { x: 0, y: 0, w: 100, h: 25 },
      { x: 100, y: 25, w: 100, h: 25 },
    ]);
  });
});

describe("nudge", () => {
  test("arrow keys move 1px, shift moves 10px", () => {
    expect(nudgeDelta("ArrowLeft", false)).toEqual({ x: -1, y: 0 });
    expect(nudgeDelta("ArrowDown", true)).toEqual({ x: 0, y: 10 });
    expect(nudgeDelta("a", false)).toBeNull();
  });
});
