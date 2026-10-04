// Animated camera moves, timed with the app's motion tokens (globals.css): a
// jump to a comment thread travels on --ease-out over --duration-panel, since
// the board's travel is what the eye follows. Pure apart from reading the
// tokens, so the curve and the in-between cameras are tested directly.

import { screenToWorld, type Camera } from "./camera";

export type Bezier = readonly [number, number, number, number];

// What globals.css sets today, for when the tokens can't be read.
export const EASE_OUT: Bezier = [0.23, 1, 0.32, 1];
export const DURATION_PANEL_MS = 260;

// "cubic-bezier(0.23, 1, 0.32, 1)" → its four numbers.
export function parseCubicBezier(css: string): Bezier | null {
  const m = css.trim().match(/^cubic-bezier\(([^)]*)\)$/);
  if (!m) return null;
  const n = m[1].split(",").map((s) => Number(s.trim()));
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null;
  if (n[0] < 0 || n[0] > 1 || n[2] < 0 || n[2] > 1) return null;
  return [n[0], n[1], n[2], n[3]];
}

// "260ms" or "0.26s" → milliseconds.
export function parseDuration(css: string): number | null {
  const m = css.trim().match(/^(\d+(?:\.\d+)?)(ms|s)$/);
  if (!m) return null;
  return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
}

// The easing function a CSS cubic-bezier() draws: progress in time (0..1) to
// progress along the move. Solved for x by Newton's method with a bisection
// fallback, like the browser does.
export function cubicBezier([x1, y1, x2, y2]: Bezier): (t: number) => number {
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const at = (s: number, p1: number, p2: number) => ((a(p1, p2) * s + b(p1, p2)) * s + c(p1)) * s;
  const slope = (s: number, p1: number, p2: number) =>
    3 * a(p1, p2) * s * s + 2 * b(p1, p2) * s + c(p1);
  const solve = (x: number) => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = at(s, x1, x2) - x;
      if (Math.abs(err) < 1e-7) return s;
      const d = slope(s, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 40; i++) {
      const v = at(s, x1, x2);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return s;
  };
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : at(solve(t), y1, y2));
}

// The camera `progress` of the way from `from` to `to` (0..1, already eased).
// The world point in the middle of the viewport travels in a straight line
// and the zoom changes by a constant factor per step, so a move that also
// zooms doesn't swing off to one side.
export function cameraBetween(
  from: Camera,
  to: Camera,
  viewport: { w: number; h: number },
  progress: number,
): Camera {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const centre = { x: viewport.w / 2, y: viewport.h / 2 };
  const a = screenToWorld(from, centre);
  const b = screenToWorld(to, centre);
  const z = from.z * Math.pow(to.z / from.z, progress);
  const x = a.x + (b.x - a.x) * progress;
  const y = a.y + (b.y - a.y) * progress;
  return { x: centre.x - x * z, y: centre.y - y * z, z };
}
