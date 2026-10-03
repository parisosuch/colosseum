// Lines and arrows: where a bound end lands on its element, straight and elbow
// routes, and the arrowhead shapes. Pure functions in world space.
//
// A bound end stores a normalized anchor in its element's box. The line is
// drawn toward that anchor and stops at the element's outline (plus a small
// gap), so it reads as attached from any direction and follows the element
// through moves and resizes without anything rewriting the connector.

import type { Point, Rect } from "./camera";
import { containsPoint, diamondCorners, rectCorners } from "./geometry";

export type OutlineShape = "rect" | "ellipse" | "diamond";

// The gap between a bound end and its element's outline, in world units.
export const BIND_GAP = 4;

export type EndInput =
  | { kind: "point"; at: Point }
  | { kind: "bound"; rect: Rect; shape: OutlineShape; ax: number; ay: number };

export function anchorPoint(r: Rect, ax: number, ay: number): Point {
  return { x: r.x + r.w * ax, y: r.y + r.h * ay };
}

// The normalized anchor for a world point inside (or near) a box.
export function anchorFor(r: Rect, p: Point): { ax: number; ay: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    ax: round(r.w > 0 ? clamp((p.x - r.x) / r.w) : 0.5),
    ay: round(r.h > 0 ? clamp((p.y - r.y) / r.h) : 0.5),
  };
}

function segIntersection(p: Point, p2: Point, q: Point, q2: Point): number | null {
  const r = { x: p2.x - p.x, y: p2.y - p.y };
  const s = { x: q2.x - q.x, y: q2.y - q.y };
  const denom = r.x * s.y - r.y * s.x;
  if (denom === 0) return null;
  const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / denom;
  const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

// Along the segment from `from` to `to`, the first t (0..1) where it meets the
// outline, or null if it doesn't.
function outlineT(shape: OutlineShape, r: Rect, from: Point, to: Point): number | null {
  if (shape === "ellipse") {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const rx = Math.max(r.w / 2, 1e-6);
    const ry = Math.max(r.h / 2, 1e-6);
    const ox = (from.x - cx) / rx;
    const oy = (from.y - cy) / ry;
    const dx = (to.x - from.x) / rx;
    const dy = (to.y - from.y) / ry;
    const a = dx * dx + dy * dy;
    const b = 2 * (ox * dx + oy * dy);
    const c = ox * ox + oy * oy - 1;
    const disc = b * b - 4 * a * c;
    if (a === 0 || disc < 0) return null;
    const sq = Math.sqrt(disc);
    const ts = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].filter((t) => t >= 0 && t <= 1);
    return ts.length ? Math.min(...ts) : null;
  }
  const corners = shape === "diamond" ? diamondCorners(r) : rectCorners(r);
  let best: number | null = null;
  for (let i = 0; i < corners.length; i++) {
    const t = segIntersection(from, to, corners[i], corners[(i + 1) % corners.length]);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

// Where a line coming from `from` toward `target` (a point inside the shape)
// should stop: on the outline, pulled back by `gap`. A `from` inside the shape
// gets the target itself, since there's no outline between them.
export function clipToOutline(
  shape: OutlineShape,
  r: Rect,
  from: Point,
  target: Point,
  gap = BIND_GAP,
): Point {
  if (containsPoint(r, from)) return target;
  const t = outlineT(shape, r, from, target);
  if (t === null) return target;
  const len = Math.hypot(target.x - from.x, target.y - from.y);
  const back = len > 0 ? gap / len : 0;
  const tt = Math.max(0, t - back);
  return { x: from.x + (target.x - from.x) * tt, y: from.y + (target.y - from.y) * tt };
}

function refPoint(end: EndInput): Point {
  return end.kind === "point" ? end.at : anchorPoint(end.rect, end.ax, end.ay);
}

function straightRoute(start: EndInput, end: EndInput): Point[] {
  const s = refPoint(start);
  const e = refPoint(end);
  const a = start.kind === "bound" ? clipToOutline(start.shape, start.rect, e, s) : s;
  const b = end.kind === "bound" ? clipToOutline(end.shape, end.rect, s, e) : e;
  return [a, b];
}

// The point where an elbow leaves a bound box: on the side facing `toward`
// along `axis`, at the anchor's position along that side, plus the gap.
function elbowExit(end: EndInput, toward: Point, axis: "h" | "v"): Point {
  if (end.kind === "point") return end.at;
  const r = end.rect;
  const a = anchorPoint(r, end.ax, end.ay);
  if (axis === "h") {
    const right = toward.x >= r.x + r.w / 2;
    return { x: right ? r.x + r.w + BIND_GAP : r.x - BIND_GAP, y: a.y };
  }
  const below = toward.y >= r.y + r.h / 2;
  return { x: a.x, y: below ? r.y + r.h + BIND_GAP : r.y - BIND_GAP };
}

// Three orthogonal segments: out along the main axis, across at the midpoint,
// and in. The main axis is whichever the two ends are further apart on.
function elbowRoute(start: EndInput, end: EndInput): Point[] {
  const s0 = refPoint(start);
  const e0 = refPoint(end);
  const axis = Math.abs(e0.x - s0.x) >= Math.abs(e0.y - s0.y) ? "h" : "v";
  const s = elbowExit(start, e0, axis);
  const e = elbowExit(end, s0, axis);
  if (axis === "h") {
    const mx = (s.x + e.x) / 2;
    if (s.y === e.y) return [s, e];
    return [s, { x: mx, y: s.y }, { x: mx, y: e.y }, e];
  }
  const my = (s.y + e.y) / 2;
  if (s.x === e.x) return [s, e];
  return [s, { x: s.x, y: my }, { x: e.x, y: my }, e];
}

export function route(start: EndInput, end: EndInput, routing: "straight" | "elbow"): Point[] {
  return routing === "elbow" ? elbowRoute(start, end) : straightRoute(start, end);
}

// --- arrowheads ---

export function headSize(width: number): number {
  return 6 + width * 2.5;
}

// How far the line stops short of the tip so a filled head isn't poked through.
export function headInset(head: string, width: number): number {
  if (head === "triangle") return headSize(width) * 0.8;
  if (head === "circle") return headSize(width) * 0.35;
  return 0;
}

// The head at `tip`, pointing away from `from`. `fill` says whether it's a
// filled shape or a stroked one.
export function headPath(
  head: string,
  tip: Point,
  from: Point,
  width: number,
): { d: string; fill: boolean } | null {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (head === "none" || len === 0) return null;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const px = -uy;
  const py = ux;
  const size = headSize(width);
  const f = (n: number) => Math.round(n * 100) / 100;
  const at = (along: number, across: number) =>
    `${f(tip.x - ux * along + px * across)} ${f(tip.y - uy * along + py * across)}`;
  switch (head) {
    case "arrow":
      return {
        d: `M ${at(size, size * 0.55)} L ${at(0, 0)} L ${at(size, -size * 0.55)}`,
        fill: false,
      };
    case "triangle":
      return {
        d: `M ${at(0, 0)} L ${at(size, size * 0.5)} L ${at(size, -size * 0.5)} Z`,
        fill: true,
      };
    case "bar":
      return { d: `M ${at(0, size * 0.6)} L ${at(0, -size * 0.6)}`, fill: false };
    case "circle": {
      const r = size * 0.35;
      const c = { x: tip.x - ux * r, y: tip.y - uy * r };
      return {
        d: `M ${f(c.x - r)} ${f(c.y)} a ${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0 a ${f(r)} ${f(r)} 0 1 0 ${f(-r * 2)} 0`,
        fill: true,
      };
    }
    default:
      return null;
  }
}

// The route with its ends pulled in for the heads, as an SVG path.
export function routePath(points: readonly Point[], startInset = 0, endInset = 0): string {
  if (points.length < 2) return "";
  const pts = points.map((p) => ({ ...p }));
  const pull = (i: number, j: number, by: number) => {
    if (by <= 0) return;
    const len = Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
    if (len === 0) return;
    const t = Math.min(by, len * 0.9) / len;
    pts[i] = { x: pts[i].x + (pts[j].x - pts[i].x) * t, y: pts[i].y + (pts[j].y - pts[i].y) * t };
  };
  pull(0, 1, startInset);
  pull(pts.length - 1, pts.length - 2, endInset);
  const f = (n: number) => Math.round(n * 100) / 100;
  return pts.map((p, i) => `${i ? "L" : "M"} ${f(p.x)} ${f(p.y)}`).join(" ");
}
