import { describe, expect, test } from "bun:test";

import { centerOn, screenToWorld } from "./camera";
import {
  cameraBetween,
  cubicBezier,
  EASE_OUT,
  parseCubicBezier,
  parseDuration,
} from "./camera-motion";

describe("motion tokens", () => {
  test("parse the way globals.css writes them", () => {
    expect(parseCubicBezier("cubic-bezier(0.23, 1, 0.32, 1)")).toEqual([0.23, 1, 0.32, 1]);
    expect(parseCubicBezier(" cubic-bezier(0.4,0,1,1) ")).toEqual([0.4, 0, 1, 1]);
    expect(parseCubicBezier("ease-out")).toBeNull();
    expect(parseCubicBezier("cubic-bezier(2, 0, 1, 1)")).toBeNull();
    expect(parseDuration("260ms")).toBe(260);
    expect(parseDuration("0.2s")).toBe(200);
    expect(parseDuration("")).toBeNull();
  });
});

describe("cubicBezier", () => {
  test("starts at 0, ends at 1 and front-loads the move for ease-out", () => {
    const ease = cubicBezier(EASE_OUT);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    // Most of the travel is done early: the strong ease-out.
    expect(ease(0.25)).toBeGreaterThan(0.7);
    let last = 0;
    for (let t = 0.05; t < 1; t += 0.05) {
      expect(ease(t)).toBeGreaterThanOrEqual(last);
      last = ease(t);
    }
  });

  test("linear control points give back the time", () => {
    const linear = cubicBezier([0, 0, 1, 1]);
    for (const t of [0.1, 0.5, 0.9]) expect(linear(t)).toBeCloseTo(t, 5);
  });
});

describe("cameraBetween", () => {
  const viewport = { w: 1000, h: 800 };
  const from = { x: 0, y: 0, z: 1 };
  const to = centerOn({ x: 2000, y: -500 }, 4, viewport);

  test("ends exactly at both cameras", () => {
    expect(cameraBetween(from, to, viewport, 0)).toEqual(from);
    expect(cameraBetween(from, to, viewport, 1)).toEqual(to);
  });

  test("moves the middle of the view in a line and zooms by a constant factor", () => {
    const mid = cameraBetween(from, to, viewport, 0.5);
    expect(mid.z).toBeCloseTo(2, 9);
    const centre = screenToWorld(mid, { x: 500, y: 400 });
    const a = screenToWorld(from, { x: 500, y: 400 });
    const b = screenToWorld(to, { x: 500, y: 400 });
    expect(centre.x).toBeCloseTo((a.x + b.x) / 2, 9);
    expect(centre.y).toBeCloseTo((a.y + b.y) / 2, 9);
  });
});
