// The pen and the highlighter. Input points are stored rounded (a tenth of a
// pixel, pressure to hundredths) and relative to the stroke's box, and the
// outline is computed with perfect-freehand when the stroke is drawn, so it
// stays sharp at any zoom and the doc holds input, not geometry.

import { getStroke } from "perfect-freehand";

import type { Point, Rect } from "./camera";
import { HIGHLIGHT_WIDTH_SCALE } from "./style";

export type InputPoint = { x: number; y: number; pressure: number };

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

// Mice and trackpads report a constant 0.5 (or 0 while a button is down in some
// browsers); only a pen gives real pressure.
export function realPressure(points: readonly number[]): boolean {
  let first: number | null = null;
  for (let i = 2; i < points.length; i += 3) {
    if (first === null) first = points[i];
    else if (points[i] !== first) return true;
  }
  return false;
}

// Turn world-space input into a stroke's box and its relative, rounded points.
// Consecutive duplicates (after rounding) are dropped.
export function strokeFromInput(input: readonly InputPoint[]): {
  box: Rect;
  points: number[];
} | null {
  if (input.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of input) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  // Whole-pixel origin, as every stored position is.
  const ox = Math.floor(minX);
  const oy = Math.floor(minY);
  const points: number[] = [];
  for (const p of input) {
    const x = r1(p.x - ox);
    const y = r1(p.y - oy);
    const pressure = r2(Math.min(1, Math.max(0, p.pressure || 0.5)));
    const n = points.length;
    if (n >= 3 && points[n - 3] === x && points[n - 2] === y) continue;
    points.push(x, y, pressure);
  }
  return {
    box: { x: ox, y: oy, w: Math.ceil(maxX - ox), h: Math.ceil(maxY - oy) },
    points,
  };
}

// Scale stored points from one box size to another (resizing a stroke).
export function scalePoints(
  points: readonly number[],
  from: { w: number; h: number },
  to: { w: number; h: number },
): number[] {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  const out: number[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    out.push(r1(points[i] * sx), r1(points[i + 1] * sy), points[i + 2]);
  }
  return out;
}

// The diameter perfect-freehand draws for a stored width.
export function strokeSize(width: number, kind: "pen" | "highlighter"): number {
  return kind === "highlighter" ? width * HIGHLIGHT_WIDTH_SCALE : width * 1.5 + 1;
}

// The stroke's outline as an SVG path, in the stroke's own coordinates.
export function strokePath(
  points: readonly number[],
  width: number,
  kind: "pen" | "highlighter",
): string {
  const input: [number, number, number][] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    input.push([points[i], points[i + 1], points[i + 2]]);
  }
  if (input.length === 0) return "";
  const outline = getStroke(input, {
    size: strokeSize(width, kind),
    thinning: kind === "highlighter" ? 0 : 0.5,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: kind === "pen" && !realPressure(points),
    last: true,
  });
  return svgPathFromOutline(outline);
}

// perfect-freehand's polygon as a closed path of quadratic curves through the
// midpoints, as its README recommends.
export function svgPathFromOutline(outline: number[][]): string {
  if (outline.length === 0) return "";
  if (outline.length < 3) {
    const [x, y] = outline[0];
    return `M ${r2(x)} ${r2(y)} Z`;
  }
  const parts: string[] = [`M ${r2(outline[0][0])} ${r2(outline[0][1])} Q`];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    parts.push(`${r2(x0)} ${r2(y0)} ${r2((x0 + x1) / 2)} ${r2((y0 + y1) / 2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

// Points as world-space input, for hit-testing.
export function inputPoints(points: readonly number[], at: Point): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    out.push({ x: at.x + points[i], y: at.y + points[i + 1] });
  }
  return out;
}
