import { expect, test } from "bun:test";

import {
  anchorBefore,
  cardsPerRow,
  dropSlotAt,
  keyboardMove,
  moveToIndex,
  moveToSlot,
  type CardBox,
} from "./block-reorder";

// A grid of `cols` square cards, 100px each with a 20px gutter, laid out the
// way the board's CSS grid lays them out.
function grid(count: number, cols: number): CardBox[] {
  return Array.from({ length: count }, (_, i) => {
    const left = (i % cols) * 120;
    const top = Math.floor(i / cols) * 120;
    return { left, top, right: left + 100, bottom: top + 100 };
  });
}

function rows(count: number): CardBox[] {
  return Array.from({ length: count }, (_, i) => ({
    left: 0,
    right: 600,
    top: i * 40,
    bottom: i * 40 + 40,
  }));
}

test("a drop in a card's left half lands before it, right half after", () => {
  const boxes = grid(6, 3);
  // Card 4 spans x 120..220 on the second row.
  expect(dropSlotAt(boxes, 130, 170, "horizontal")).toBe(4);
  expect(dropSlotAt(boxes, 210, 170, "horizontal")).toBe(5);
});

test("a drop in the gutter snaps to the nearest card", () => {
  const boxes = grid(6, 3);
  // x = 110 is between card 0 (ends at 100) and card 1 (starts at 120), a
  // little nearer card 0's right edge.
  expect(dropSlotAt(boxes, 110, 50, "horizontal")).toBe(1);
});

test("a drop past the end of a short last row lands at the end", () => {
  // Four cards in a three-wide grid: the second row holds one.
  const boxes = grid(4, 3);
  expect(dropSlotAt(boxes, 400, 170, "horizontal")).toBe(4);
});

test("a drop past either end of the board lands at that end", () => {
  const boxes = grid(6, 3);
  expect(dropSlotAt(boxes, 60, 900, "horizontal")).toBe(6);
  expect(dropSlotAt(boxes, 60, -50, "horizontal")).toBe(0);
  expect(dropSlotAt([], 10, 10, "horizontal")).toBeNull();
});

test("a drop between two grid rows still resolves", () => {
  const boxes = grid(6, 3);
  // y = 110 is in the 20px gutter between the two rows, nearest card 3.
  expect(dropSlotAt(boxes, 40, 110, "horizontal")).toBe(3);
});

test("list rows split top and bottom, not left and right", () => {
  const boxes = rows(4);
  expect(dropSlotAt(boxes, 300, 85, "vertical")).toBe(2);
  expect(dropSlotAt(boxes, 300, 110, "vertical")).toBe(3);
});

test("dropping a card into either slot beside itself changes nothing", () => {
  const items = [1, 2, 3, 4];
  expect(moveToSlot(items, 1, 1)).toBe(items);
  expect(moveToSlot(items, 1, 2)).toBe(items);
});

test("moveToSlot accounts for the hole the moved card leaves", () => {
  const items = ["a", "b", "c", "d"];
  // "a" dropped into the gap before "d" — after removal that is index 2.
  expect(moveToSlot(items, 0, 3)).toEqual(["b", "c", "a", "d"]);
  // "d" dropped at the very front.
  expect(moveToSlot(items, 3, 0)).toEqual(["d", "a", "b", "c"]);
  // "d" dropped past the end is a no-op.
  expect(moveToSlot(items, 3, 4)).toBe(items);
});

test("the anchor is the block in front, and null at the head", () => {
  const items = [{ id: 10 }, { id: 20 }, { id: 30 }];
  expect(anchorBefore(items, 0)).toBeNull();
  expect(anchorBefore(items, 1)).toBe(10);
  expect(anchorBefore(items, 2)).toBe(20);
});

test("a pointer drag resolves to the block the moved one now follows", () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  // Drag card 4 into the gap between 1 and 2.
  const next = moveToSlot(items, 3, 1);
  expect(next.map((c) => c.id)).toEqual([1, 4, 2, 3]);
  expect(
    anchorBefore(
      next,
      next.findIndex((c) => c.id === 4),
    ),
  ).toBe(1);
});

test("cardsPerRow reads the column count off the layout", () => {
  expect(cardsPerRow(grid(11, 4))).toBe(4);
  expect(cardsPerRow(grid(2, 6))).toBe(2); // fewer cards than columns
  expect(cardsPerRow(rows(5))).toBe(1);
  expect(cardsPerRow([])).toBe(1);
});

test("cardsPerRow tolerates sub-pixel row tops", () => {
  const boxes = grid(6, 3);
  boxes[1].top += 0.4;
  boxes[2].top -= 0.3;
  expect(cardsPerRow(boxes)).toBe(3);
});

test("arrows step by one and by a row, clamping at the ends", () => {
  expect(keyboardMove(4, "ArrowLeft", 10, 3)).toBe(3);
  expect(keyboardMove(4, "ArrowRight", 10, 3)).toBe(5);
  expect(keyboardMove(4, "ArrowUp", 10, 3)).toBe(1);
  expect(keyboardMove(4, "ArrowDown", 10, 3)).toBe(7);
  expect(keyboardMove(1, "ArrowUp", 10, 3)).toBe(0); // clamps, doesn't refuse
  expect(keyboardMove(8, "ArrowDown", 10, 3)).toBe(9);
  expect(keyboardMove(0, "ArrowUp", 10, 3)).toBeNull(); // already there
  expect(keyboardMove(9, "ArrowRight", 10, 3)).toBeNull();
});

test("Home and End reach the ends of a long channel", () => {
  expect(keyboardMove(200, "Home", 400, 6)).toBe(0);
  expect(keyboardMove(200, "End", 400, 6)).toBe(399);
  expect(keyboardMove(0, "Home", 400, 6)).toBeNull();
});

test("keys that aren't moves are left alone, and a lone card can't move", () => {
  expect(keyboardMove(0, "Tab", 10, 3)).toBeNull();
  expect(keyboardMove(0, "a", 10, 3)).toBeNull();
  expect(keyboardMove(0, "ArrowRight", 1, 3)).toBeNull();
});

test("moveToIndex places by destination card, not by gap", () => {
  const items = ["a", "b", "c", "d"];
  expect(moveToIndex(items, 0, 2)).toEqual(["b", "c", "a", "d"]);
  expect(moveToIndex(items, 3, 0)).toEqual(["d", "a", "b", "c"]);
  expect(moveToIndex(items, 1, 1)).toBe(items);
  expect(moveToIndex(items, 1, 9)).toBe(items);
});

test("a walk of arrow moves ends where the arithmetic says it should", () => {
  let items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  let index = 8;
  for (const key of ["ArrowUp", "ArrowLeft", "ArrowUp"]) {
    const target = keyboardMove(index, key, items.length, 3);
    expect(target).not.toBeNull();
    items = moveToIndex(items, index, target!);
    index = target!;
  }
  // 9 lifted from the end: up a row to index 5, left to 4, up a row to 1.
  expect(items).toEqual([1, 9, 2, 3, 4, 5, 6, 7, 8]);
  expect(index).toBe(1);
});
