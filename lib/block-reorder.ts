// Geometry and index arithmetic for dragging a block card to a new slot.
//
// React-free on purpose, the same split as lib/near-viewport.ts: the hook that
// binds pointer and key events to a board lives in components/use-block-reorder.ts,
// and everything here is a pure function over rectangles and indices so it can
// be tested without a DOM. The interesting failures in a reorder are all here —
// which gap a pointer is over, what an arrow key means in a wrapped grid,
// which block the server should be told to place the moved one after — and none
// of them need a browser to reproduce.

// One card's box, in page coordinates. A DOMRect satisfies this.
export type CardBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

// The axis a layout puts consecutive cards along: the grid runs left to right
// and wraps, the list runs top to bottom.
export type ReorderAxis = "horizontal" | "vertical";

function centre(box: CardBox, axis: ReorderAxis): number {
  return axis === "horizontal" ? (box.left + box.right) / 2 : (box.top + box.bottom) / 2;
}

// Distance from a point to a box, zero inside it. Used only to pick the nearest
// card when the pointer is in a gutter or past the end of the last row.
function distance(box: CardBox, x: number, y: number): number {
  const dx = Math.max(box.left - x, 0, x - box.right);
  const dy = Math.max(box.top - y, 0, y - box.bottom);
  return Math.hypot(dx, dy);
}

// Which gap a drop at (x, y) lands in, as a slot index in [0, boxes.length]:
// slot i means "before the card currently at index i", and boxes.length means
// "after the last card". Null when there are no cards to drop between.
//
// The pointer is usually inside a card, and the half it is in decides which
// side of that card the block lands on. Everywhere else has to resolve to
// something too — a drop that quietly does nothing because it missed a gutter
// by four pixels is worse than a drop that guesses:
//
//   - Past the last row (or above the first), the answer is the end of the
//     list. A grid's final row is usually short, so the empty space beside it
//     is a large and obvious-looking target for "put it last".
//   - Otherwise, the card is picked from the row the pointer is in, by how far
//     along that row it is. Picking by straight-line distance instead would
//     make the space to the right of a short last row snap up into the row
//     above, which is nowhere near where the pointer is pointing.
export function dropSlotAt(
  boxes: CardBox[],
  x: number,
  y: number,
  axis: ReorderAxis,
): number | null {
  if (boxes.length === 0) return null;

  // "Along the row" vs "which row": the grid wraps left to right, the list
  // runs top to bottom and every row is full width.
  const along = axis === "horizontal" ? x : y;
  const across = axis === "horizontal" ? y : x;
  const rowStart = (box: CardBox) => (axis === "horizontal" ? box.top : box.left);
  const rowEnd = (box: CardBox) => (axis === "horizontal" ? box.bottom : box.right);

  if (across < Math.min(...boxes.map(rowStart))) return 0;
  if (across > Math.max(...boxes.map(rowEnd))) return boxes.length;

  let index = -1;
  let best = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    if (across < rowStart(box) || across > rowEnd(box)) continue;
    const d = Math.max(box.left - x, 0, x - box.right, box.top - y, 0, y - box.bottom);
    if (d < best) {
      best = d;
      index = i;
    }
  }
  if (index < 0) {
    // Between two rows, in the gutter. Nothing shares the pointer's band, so
    // fall back to whatever is closest in both axes — taking the later card on
    // a tie, so a pointer sitting exactly in a gutter resolves to the boundary
    // between the two rows rather than to somewhere inside the one above.
    for (let i = 0; i < boxes.length; i++) {
      const d = distance(boxes[i], x, y);
      if (d <= best) {
        best = d;
        index = i;
      }
    }
  }

  return along > centre(boxes[index], axis) ? index + 1 : index;
}

// Move the item at `from` into `slot`, where `slot` counts gaps in the list as
// it is *before* the move. Dropping a card into the gap just after itself, or
// just before, is a no-op — the two slots either side of a card both describe
// where it already is.
export function moveToSlot<T>(items: T[], from: number, slot: number): T[] {
  if (from < 0 || from >= items.length) return items;
  if (slot === from || slot === from + 1) return items;
  const to = slot > from ? slot - 1 : slot;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// The block the moved one now sits directly after, or null when it is first.
// This — rather than an index — is what the reorder action takes: an index into
// a page the server never saw is meaningless once other people are adding and
// moving blocks, and a board that has loaded 50 of 400 blocks does not know
// what follows its last card. Naming the block in front lets the server look up
// what actually comes next and place the key between the two.
export function anchorBefore<T extends { id: number }>(items: T[], index: number): number | null {
  return index > 0 && index < items.length ? items[index - 1].id : null;
}

// How many cards a row holds, read off the laid-out boxes rather than the
// Tailwind breakpoints that produced them — the grid is 2 to 6 columns
// depending on viewport, and the arrow keys need the number the browser
// actually chose. Cards in the first row share a top edge; sub-pixel layout
// means comparing with a tolerance rather than for equality.
export function cardsPerRow(boxes: CardBox[]): number {
  if (boxes.length === 0) return 1;
  const top = boxes[0].top;
  let n = 0;
  while (n < boxes.length && Math.abs(boxes[n].top - top) < 2) n++;
  return Math.max(1, n);
}

// Where an arrow key moves a lifted block, as a new index, or null when the key
// isn't a move or the block is already against that edge. Left/right step one
// card; up/down step a row, which is one card in a list and a row's worth in a
// grid. Home and End go to the ends, which is otherwise a long hold in a
// 400-block channel.
export function keyboardMove(
  index: number,
  key: string,
  count: number,
  perRow: number,
): number | null {
  if (count <= 1) return null;
  let target: number;
  switch (key) {
    case "ArrowLeft":
      target = index - 1;
      break;
    case "ArrowRight":
      target = index + 1;
      break;
    case "ArrowUp":
      target = index - perRow;
      break;
    case "ArrowDown":
      target = index + perRow;
      break;
    case "Home":
      target = 0;
      break;
    case "End":
      target = count - 1;
      break;
    default:
      return null;
  }
  // A step off the end clamps rather than doing nothing: pressing Down on the
  // last row should reach the end of the channel, not refuse.
  target = Math.min(Math.max(target, 0), count - 1);
  return target === index ? null : target;
}

// Move the item at `from` to the index `to` (not a gap — the slot arithmetic of
// moveToSlot is for pointers, and an arrow key names a destination card).
export function moveToIndex<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return items;
  }
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
