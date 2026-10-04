// Snapping while dragging: a moving box snaps its left, centre and right (and
// top, middle and bottom) to the same lines on other elements, and to equal
// spacing with its neighbours. Each axis snaps on its own, to whichever
// candidate is closest within the threshold. The result carries the guides to
// draw: lines through the matched edges with a mark at each end of every box
// on them, and the equal gaps with their size.
//
// With the grid showing and snapping to it on, a box's edges also snap to the
// nearest grid line within the threshold, unless an element candidate is at
// least as close. The grid lines caught are drawn dashed, with the box's
// top-left in world units beside them.

import type { Point, Rect } from "./camera";
import { gridDelta } from "./grid";

// In screen pixels; callers divide by the zoom.
export const SNAP_THRESHOLD = 6;

export type Guide =
  | { kind: "line"; axis: "x" | "y"; at: number; from: number; to: number; marks: number[] }
  | { kind: "gap"; axis: "x" | "y"; from: number; to: number; at: number; size: number }
  | { kind: "grid"; axis: "x" | "y"; at: number; from: number; to: number; marks: number[] }
  | { kind: "position"; x: number; y: number };

export type SnapResult = { dx: number; dy: number; guides: Guide[] };

type Axis = "x" | "y";

function lo(r: Rect, axis: Axis) {
  return axis === "x" ? r.x : r.y;
}
function size(r: Rect, axis: Axis) {
  return axis === "x" ? r.w : r.h;
}
function hi(r: Rect, axis: Axis) {
  return lo(r, axis) + size(r, axis);
}
function lines(r: Rect, axis: Axis): number[] {
  return [lo(r, axis), lo(r, axis) + size(r, axis) / 2, hi(r, axis)];
}
function other(axis: Axis): Axis {
  return axis === "x" ? "y" : "x";
}
// Whether two boxes overlap on the other axis, which is what makes them
// neighbours for equal spacing along this one.
function facing(a: Rect, b: Rect, axis: Axis): boolean {
  const o = other(axis);
  return lo(a, o) < hi(b, o) && lo(b, o) < hi(a, o);
}

type Candidate = { delta: number };

// The equal-spacing candidates along one axis: centred between the nearest
// neighbours on each side, or continuing the gap of a neighbouring pair.
function spacingDeltas(m: Rect, others: readonly Rect[], axis: Axis): number[] {
  const near = others.filter((r) => facing(m, r, axis));
  const before = near
    .filter((r) => hi(r, axis) <= lo(m, axis))
    .sort((a, b) => hi(b, axis) - hi(a, axis));
  const after = near
    .filter((r) => lo(r, axis) >= hi(m, axis))
    .sort((a, b) => lo(a, axis) - lo(b, axis));
  const out: number[] = [];
  const A = before[0];
  const B = after[0];
  if (A && B) {
    const target = (hi(A, axis) + lo(B, axis) - size(m, axis)) / 2;
    out.push(target - lo(m, axis));
  }
  if (A) {
    const A2 = others
      .filter((r) => facing(A, r, axis) && hi(r, axis) <= lo(A, axis))
      .sort((a, b) => hi(b, axis) - hi(a, axis))[0];
    if (A2) out.push(hi(A, axis) + (lo(A, axis) - hi(A2, axis)) - lo(m, axis));
  }
  if (B) {
    const B2 = others
      .filter((r) => facing(B, r, axis) && lo(r, axis) >= hi(B, axis))
      .sort((a, b) => lo(a, axis) - lo(b, axis))[0];
    if (B2) out.push(lo(B, axis) - (lo(B2, axis) - hi(B, axis)) - hi(m, axis));
  }
  return out;
}

function bestDelta(
  m: Rect,
  others: readonly Rect[],
  axis: Axis,
  threshold: number,
  spacing: boolean,
): number | null {
  let best: Candidate | null = null;
  const consider = (delta: number) => {
    if (Math.abs(delta) > threshold) return;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta };
  };
  const mine = lines(m, axis);
  for (const r of others) {
    for (const theirs of lines(r, axis)) for (const v of mine) consider(theirs - v);
  }
  if (spacing) for (const d of spacingDeltas(m, others, axis)) consider(d);
  return best ? (best as Candidate).delta : null;
}

const EPS = 0.5;

function guidesFor(m: Rect, others: readonly Rect[], axis: Axis, spacing: boolean): Guide[] {
  const out: Guide[] = [];
  const o = other(axis);
  // Alignment lines.
  for (const v of lines(m, axis)) {
    const matched = others.filter((r) => lines(r, axis).some((t) => Math.abs(t - v) < EPS));
    if (matched.length === 0) continue;
    const all = [m, ...matched];
    const marks = all.flatMap((r) => [lo(r, o), hi(r, o)]);
    out.push({
      kind: "line",
      axis,
      at: v,
      from: Math.min(...marks),
      to: Math.max(...marks),
      marks: [...new Set(marks)],
    });
  }
  if (!spacing) return out;
  // Equal gaps: the gap on each side of the moving box, and the neighbouring
  // pair it matches, drawn when they're equal.
  const near = others.filter((r) => facing(m, r, axis));
  const before = near
    .filter((r) => hi(r, axis) <= lo(m, axis) + EPS)
    .sort((a, b) => hi(b, axis) - hi(a, axis))[0];
  const after = near
    .filter((r) => lo(r, axis) >= hi(m, axis) - EPS)
    .sort((a, b) => lo(a, axis) - lo(b, axis))[0];
  const gap = (a: Rect, b: Rect) => lo(b, axis) - hi(a, axis);
  const mid = (a: Rect, b: Rect) => {
    const top = Math.max(lo(a, o), lo(b, o));
    const bottom = Math.min(hi(a, o), hi(b, o));
    return (top + bottom) / 2;
  };
  const gapGuide = (a: Rect, b: Rect): Guide => ({
    kind: "gap",
    axis,
    from: hi(a, axis),
    to: lo(b, axis),
    at: mid(a, b),
    size: Math.round(gap(a, b)),
  });
  const shown: Guide[] = [];
  if (before && after && Math.abs(gap(before, m) - gap(m, after)) < EPS) {
    shown.push(gapGuide(before, m), gapGuide(m, after));
  }
  if (before) {
    const prev = others
      .filter((r) => facing(before, r, axis) && hi(r, axis) <= lo(before, axis) + EPS)
      .sort((a, b) => hi(b, axis) - hi(a, axis))[0];
    if (prev && Math.abs(gap(prev, before) - gap(before, m)) < EPS) {
      shown.push(gapGuide(prev, before), gapGuide(before, m));
    }
  }
  if (after) {
    const next = others
      .filter((r) => facing(after, r, axis) && lo(r, axis) >= hi(after, axis) - EPS)
      .sort((a, b) => lo(a, axis) - lo(b, axis))[0];
    if (next && Math.abs(gap(m, after) - gap(after, next)) < EPS) {
      shown.push(gapGuide(m, after), gapGuide(after, next));
    }
  }
  const seen = new Set<string>();
  for (const g of shown) {
    if (g.kind !== "gap") continue;
    const key = `${g.from}:${g.to}:${g.at}`;
    if (seen.has(key) || g.size <= 0) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

// The nearer of the box's two edges to a grid line, within the threshold.
function gridCandidate(
  m: Rect,
  axis: Axis,
  step: number,
  threshold: number,
): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of [lo(m, axis), hi(m, axis)]) {
    const delta = gridDelta(v, step);
    if (Math.abs(delta) > threshold) continue;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, at: v + delta };
  }
  return best;
}

// The grid line an edge was caught on, drawn two steps past the box, with a
// mark where each of its corners lands.
function gridGuide(m: Rect, axis: Axis, at: number, step: number): Guide {
  const o = other(axis);
  return {
    kind: "grid",
    axis,
    at,
    from: lo(m, o) - 2 * step,
    to: hi(m, o) + 2 * step,
    marks: [...new Set([lo(m, o), hi(m, o)])],
  };
}

export type SnapOptions = {
  spacing?: boolean;
  // The grid step in world units, when the grid shows and snaps.
  grid?: number | null;
};

// Snap a moving box against `others`. `threshold` is in world units.
export function snapRect(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
  { spacing = true, grid = null }: SnapOptions = {},
): SnapResult {
  // Per axis: the element candidate when it's at least as close as the grid
  // line, else the grid line.
  const axisDelta = (axis: Axis) => {
    const element = bestDelta(moving, others, axis, threshold, spacing);
    const g = grid ? gridCandidate(moving, axis, grid, threshold) : null;
    if (g && (element === null || Math.abs(g.delta) < Math.abs(element))) {
      return { delta: g.delta, gridAt: g.at };
    }
    return { delta: element ?? 0, gridAt: null };
  };
  const x = axisDelta("x");
  const y = axisDelta("y");
  const snapped = { ...moving, x: moving.x + x.delta, y: moving.y + y.delta };
  const guides = [
    ...guidesFor(snapped, others, "x", spacing),
    ...guidesFor(snapped, others, "y", spacing),
  ];
  if (grid && (x.gridAt !== null || y.gridAt !== null)) {
    if (x.gridAt !== null) guides.push(gridGuide(snapped, "x", x.gridAt, grid));
    if (y.gridAt !== null) guides.push(gridGuide(snapped, "y", y.gridAt, grid));
    guides.push({ kind: "position", x: snapped.x, y: snapped.y });
  }
  return { dx: x.delta, dy: y.delta, guides };
}

// Snap a single point (a resize handle, a shape's corner while drawing it, a
// line end) to other boxes' edges and centres, and to the grid when `grid` is
// set.
export function snapPoint(
  p: Point,
  others: readonly Rect[],
  threshold: number,
  { grid = null }: { grid?: number | null } = {},
): SnapResult {
  return snapRect({ x: p.x, y: p.y, w: 0, h: 0 }, others, threshold, { spacing: false, grid });
}
