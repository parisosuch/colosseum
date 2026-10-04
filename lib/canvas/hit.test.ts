import { describe, expect, test } from "bun:test";

import { paintOrder } from "./elements";
import {
  bindTarget,
  eraserHits,
  hitLeaf,
  marqueeSelect,
  selectTarget,
  type HitContext,
} from "./hit";
import { docWith, state } from "./test-doc";

function ctx(doc: ReturnType<typeof docWith>): HitContext {
  const { all, layout } = state(doc);
  return { all, ordered: paintOrder(all), geom: layout.geom };
}

const scene = () =>
  docWith({
    hollow: { type: "rect", x: 0, y: 0, w: 100, h: 100, fill: "none", width: 2 },
    solid: { type: "ellipse", x: 200, y: 0, w: 100, h: 100, fill: "yellow", width: 2 },
    pen: {
      type: "stroke",
      x: 0,
      y: 200,
      w: 100,
      h: 10,
      points: [0, 0, 0.5, 100, 10, 0.5],
      width: 2,
      kind: "pen",
    },
    frame: { type: "frame", x: 400, y: 0, w: 300, h: 300, name: "Ideas", fill: "card" },
    kid: { type: "rect", x: 250, y: 20, w: 100, h: 50, parentId: "frame", fill: "yellow" },
    locked: { type: "rect", x: 0, y: 400, w: 50, h: 50, fill: "yellow", locked: true },
    g: { type: "group", x: 0, y: 600 },
    g1: { type: "rect", x: 0, y: 0, w: 40, h: 40, parentId: "g", fill: "yellow" },
    inner: { type: "group", x: 100, y: 0, parentId: "g" },
    g2: { type: "rect", x: 0, y: 0, w: 40, h: 40, parentId: "inner", fill: "yellow" },
  });

describe("hit-testing", () => {
  test("unfilled shapes are picked by their outline, filled ones anywhere inside", () => {
    const c = ctx(scene());
    expect(hitLeaf(c, { x: 50, y: 50 }, 1)).toBeNull();
    expect(hitLeaf(c, { x: 1, y: 50 }, 1)).toBe("hollow");
    expect(hitLeaf(c, { x: 250, y: 50 }, 1)).toBe("solid");
    // Outside the ellipse but inside its box.
    expect(hitLeaf(c, { x: 205, y: 5 }, 1)).toBeNull();
  });

  test("pen strokes are picked by their ink, with a tolerance that follows the zoom", () => {
    const c = ctx(scene());
    expect(hitLeaf(c, { x: 50, y: 205 }, 1)).toBe("pen");
    expect(hitLeaf(c, { x: 50, y: 230 }, 1)).toBeNull();
    expect(hitLeaf(c, { x: 50, y: 230 }, 0.2)).toBe("pen");
  });

  test("frames by border or label; their empty inside stops the search", () => {
    const c = ctx(scene());
    expect(hitLeaf(c, { x: 401, y: 150 }, 1)).toBe("frame");
    expect(hitLeaf(c, { x: 410, y: -10 }, 1)).toBe("frame");
    expect(hitLeaf(c, { x: 500, y: 150 }, 1)).toBeNull();
    expect(hitLeaf(c, { x: 680, y: 40 }, 1)).toBe("kid");
    // The child's part outside the frame is clipped away.
    expect(hitLeaf(c, { x: 720, y: 40 }, 1)).toBeNull();
  });

  test("locked elements can't be hit on the canvas", () => {
    const c = ctx(scene());
    expect(hitLeaf(c, { x: 25, y: 425 }, 1)).toBeNull();
    expect(hitLeaf(c, { x: 25, y: 425 }, 1, { includeLocked: true })).toBe("locked");
  });

  test("a click selects the outermost group; double-click and cmd+click go in", () => {
    const { all } = state(scene());
    const none = new Set<string>();
    expect(selectTarget("g2", all, none)).toBe("g");
    expect(selectTarget("g2", all, none, { deep: true })).toBe("g2");
    expect(selectTarget("g2", all, new Set(["g"]), { drill: true })).toBe("inner");
    expect(selectTarget("g2", all, new Set(["inner"]), { drill: true })).toBe("g2");
    // Already inside g (g1 selected): the next click picks within g.
    expect(selectTarget("g2", all, new Set(["g1"]))).toBe("inner");
  });

  test("marquee: touching selects, frames only when covered, groups as a whole", () => {
    const c = ctx(scene());
    expect(marqueeSelect(c, { x: -10, y: 580, w: 30, h: 30 })).toEqual(["g"]);
    expect(marqueeSelect(c, { x: 600, y: 0, w: 60, h: 60 })).toEqual(["kid"]);
    expect(marqueeSelect(c, { x: 390, y: -30, w: 400, h: 400 })).toEqual(["frame"]);
    expect(marqueeSelect(c, { x: -10, y: 390, w: 100, h: 100 })).toEqual([]);
  });
});

describe("eraser", () => {
  test("takes whole elements the path crosses, not ones it passes inside", () => {
    const c = ctx(scene());
    // Through the middle of the hollow rect: misses it.
    expect(eraserHits(c, { x: 40, y: 50 }, { x: 60, y: 50 }, 1)).toEqual([]);
    // Across its edge and the pen stroke.
    expect(eraserHits(c, { x: 50, y: 90 }, { x: 50, y: 210 }, 1).sort()).toEqual(["hollow", "pen"]);
    // Inside a frame: the child, not the frame.
    expect(eraserHits(c, { x: 660, y: 30 }, { x: 670, y: 40 }, 1)).toEqual(["kid"]);
    // Across the frame's border.
    expect(eraserHits(c, { x: 390, y: 150 }, { x: 410, y: 150 }, 1)).toEqual(["frame"]);
    // Not locked ones.
    expect(eraserHits(c, { x: 0, y: 425 }, { x: 50, y: 425 }, 1)).toEqual([]);
  });

  test("blocks are erased like any element", () => {
    const doc = docWith({ b: { type: "block", columnId: 7, x: 0, y: 0, w: 100, h: 100 } });
    expect(eraserHits(ctx(doc), { x: 50, y: -10 }, { x: 50, y: 10 }, 1)).toEqual(["b"]);
  });
});

describe("binding targets", () => {
  test("the topmost element under the end, never a connector", () => {
    const c = ctx(scene());
    expect(bindTarget(c, { x: 50, y: 50 }, new Set())).toBe("hollow");
    expect(bindTarget(c, { x: 25, y: 425 }, new Set())).toBe("locked");
    expect(bindTarget(c, { x: 500, y: 150 }, new Set())).toBe("frame");
    expect(bindTarget(c, { x: 1000, y: 1000 }, new Set())).toBeNull();
  });
});
