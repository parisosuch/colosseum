import { describe, expect, test } from "bun:test";
import * as Y from "yjs";

import { elementsOf } from "./canvas-doc";
import { threadOffset, threadPosition } from "./canvas-threads";

function docOf(elements: Record<string, Record<string, unknown>>): Y.Map<Y.Map<unknown>> {
  const doc = new Y.Doc();
  const map = elementsOf(doc);
  for (const [id, fields] of Object.entries(elements)) {
    const el = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(fields)) el.set(k, v);
    map.set(id, el);
  }
  return map;
}

function close(p: { x: number; y: number } | null, x: number, y: number) {
  expect(p).not.toBeNull();
  expect(p!.x).toBeCloseTo(x, 9);
  expect(p!.y).toBeCloseTo(y, 9);
}

describe("threadPosition", () => {
  test("an unrotated element adds the offset to its world position", () => {
    const els = docOf({ card: { x: 10, y: 20, w: 100, h: 50, rotation: 0, parentId: null } });
    expect(threadPosition(els, "card", { offset_x: 5, offset_y: 6 })).toEqual({ x: 15, y: 26 });
  });

  test("a missing rotation counts as none, and a missing offset as the corner", () => {
    const els = docOf({ card: { x: 10, y: 20, w: 100, h: 50 } });
    expect(threadPosition(els, "card", { offset_x: null, offset_y: null })).toEqual({
      x: 10,
      y: 20,
    });
  });

  test("the offset turns with the element about its centre", () => {
    // Box (100, 100)–(200, 150), centre (150, 125).
    const els = docOf({ card: { x: 100, y: 100, w: 100, h: 50, rotation: 90 } });
    // Top-left corner: (-50, -25) from the centre turns to (25, -50).
    close(threadPosition(els, "card", { offset_x: 0, offset_y: 0 }), 175, 75);
    // The centre doesn't move.
    close(threadPosition(els, "card", { offset_x: 50, offset_y: 25 }), 150, 125);
    // Half a turn: bottom-right corner lands on the top-left one.
    els.get("card")!.set("rotation", 180);
    close(threadPosition(els, "card", { offset_x: 100, offset_y: 50 }), 100, 100);
    // A full turn is no turn.
    els.get("card")!.set("rotation", 360);
    expect(threadPosition(els, "card", { offset_x: 3, offset_y: 4 })).toEqual({ x: 103, y: 104 });
  });

  test("a rotated frame holding a rotated element turns the pin by both", () => {
    const els = docOf({
      outer: { type: "frame", x: 1000, y: 0, w: 800, h: 800, parentId: null },
      inner: { type: "frame", x: 100, y: 200, w: 400, h: 400, parentId: "outer", rotation: 90 },
      card: { type: "rect", x: 10, y: 20, w: 40, h: 40, parentId: "inner", rotation: -90 },
    });
    // The card's quarter turn back takes its top-right corner (+20, -20 from
    // its centre) to (-20, -20): (10, 20) in the inner frame. The frame's
    // quarter turn about its centre (200, 200) takes (-190, -180) to
    // (180, -190): (480, 210) in the outer frame, (1480, 210) in the world.
    close(threadPosition(els, "card", { offset_x: 40, offset_y: 0 }), 1480, 210);
    // Moving the outer frame moves the pin with it.
    els.get("outer")!.set("x", 0);
    close(threadPosition(els, "card", { offset_x: 40, offset_y: 0 }), 480, 210);
    // Turning the inner frame back leaves only the card's own turn.
    els.get("inner")!.set("rotation", 0);
    close(threadPosition(els, "card", { offset_x: 40, offset_y: 0 }), 110, 220);
  });

  test("a rotated frame turns an unrotated child with it", () => {
    const els = docOf({
      frame: { type: "frame", x: 100, y: 200, w: 400, h: 400, rotation: 90 },
      card: { type: "rect", x: 10, y: 20, w: 40, h: 40, parentId: "frame" },
    });
    // The card's bottom-right corner is (50, 60) in the frame, (-150, -140)
    // from its centre, which a quarter turn takes to (140, -150).
    close(threadPosition(els, "card", { offset_x: 40, offset_y: 40 }), 440, 250);
  });

  test("a rotated group turns its children about its own box", () => {
    // A group with no stored size turns about its origin.
    const els = docOf({
      g: { type: "group", x: 0, y: 0, w: 0, h: 0, rotation: 180 },
      dot: { type: "rect", x: 10, y: 10, w: 10, h: 10, parentId: "g" },
    });
    close(threadPosition(els, "dot", { offset_x: 0, offset_y: 0 }), -10, -10);
  });

  test("an element that's gone, or has no position, has no thread position", () => {
    const els = docOf({ bad: { x: "1", y: 2 } });
    expect(threadPosition(els, "nope", { offset_x: 0, offset_y: 0 })).toBeNull();
    expect(threadPosition(els, "bad", { offset_x: 0, offset_y: 0 })).toBeNull();
  });
});

describe("threadOffset", () => {
  test("undoes threadPosition, rotated or not, nested or not", () => {
    const els = docOf({
      frame: { type: "frame", x: -300, y: 40, w: 500, h: 500, parentId: null },
      flat: { x: 10, y: 20, w: 100, h: 50, parentId: "frame" },
      turned: { x: 10, y: 20, w: 100, h: 50, rotation: 33, parentId: "frame" },
      odd: { x: 0, y: 0, w: 7, h: 300, rotation: -200 },
      deep: { x: 3, y: -9, w: 20, h: 10, rotation: 71, parentId: "turned" },
    });
    for (const id of ["flat", "turned", "odd", "deep"]) {
      for (const at of [
        { x: -280, y: 70 },
        { x: 0, y: 0 },
        { x: 123.5, y: -77.25 },
      ]) {
        const offset = threadOffset(els, id, at);
        expect(offset).not.toBeNull();
        close(threadPosition(els, id, offset!), at.x, at.y);
      }
    }
  });

  test("is in the element's unrotated box", () => {
    const els = docOf({ card: { x: 100, y: 100, w: 100, h: 50, rotation: 90 } });
    // (175, 75) is where the top-left corner sits after the quarter turn.
    const offset = threadOffset(els, "card", { x: 175, y: 75 })!;
    expect(offset.offset_x).toBeCloseTo(0, 9);
    expect(offset.offset_y).toBeCloseTo(0, 9);
    expect(threadOffset(els, "nope", { x: 0, y: 0 })).toBeNull();
  });
});
