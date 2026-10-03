import { describe, expect, test } from "bun:test";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  cameraTransform,
  centerOn,
  clampZoom,
  fitBounds,
  panBy,
  screenToWorld,
  stepZoom,
  viewCenter,
  visibleWorldRect,
  wheelPixels,
  wheelZoomFactor,
  worldRectToScreen,
  worldToScreen,
  zoomAt,
  zoomLabel,
} from "./camera";

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe("camera math", () => {
  test("screen and world round-trip", () => {
    const cam = { x: 120, y: -40, z: 2.5 };
    const w = { x: 33, y: -7 };
    const s = worldToScreen(cam, w);
    expect(s).toEqual({ x: 33 * 2.5 + 120, y: -7 * 2.5 - 40 });
    const back = screenToWorld(cam, s);
    close(back.x, w.x);
    close(back.y, w.y);
  });

  test("zoomAt keeps the world point under the pointer", () => {
    const cam = { x: 10, y: 20, z: 1 };
    const at = { x: 400, y: 300 };
    const before = screenToWorld(cam, at);
    for (const z of [0.1, 0.5, 2, 4]) {
      const next = zoomAt(cam, at, z);
      expect(next.z).toBe(z);
      const after = screenToWorld(next, at);
      close(after.x, before.x);
      close(after.y, before.y);
    }
  });

  test("zoom is clamped, and garbage resets to 100%", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(zoomAt({ x: 0, y: 0, z: 1 }, { x: 0, y: 0 }, 1000).z).toBe(MAX_ZOOM);
  });

  test("pan moves the camera, not the zoom", () => {
    expect(panBy({ x: 1, y: 2, z: 3 }, 10, -5)).toEqual({ x: 11, y: -3, z: 3 });
  });

  test("visible world rect", () => {
    const r = visibleWorldRect({ x: -100, y: -50, z: 2 }, { w: 800, h: 600 });
    expect(r).toEqual({ x: 50, y: 25, w: 400, h: 300 });
  });

  test("world rect to screen", () => {
    expect(worldRectToScreen({ x: 5, y: 5, z: 0.5 }, { x: 10, y: 20, w: 100, h: 50 })).toEqual({
      x: 10,
      y: 15,
      w: 50,
      h: 25,
    });
  });

  test("step zoom walks powers of two and snaps from in between", () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(1, -1)).toBe(0.5);
    expect(stepZoom(0.5, -1)).toBe(0.25);
    expect(stepZoom(0.7, 1)).toBe(1);
    expect(stepZoom(0.7, -1)).toBe(0.5);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(0.0625, -1)).toBe(MIN_ZOOM);
  });

  test("wheel deltas: lines become pixels, factor is symmetric and bounded", () => {
    expect(wheelPixels(3, 1)).toBe(48);
    expect(wheelPixels(3, 0)).toBe(3);
    close(wheelZoomFactor(40) * wheelZoomFactor(-40), 1);
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    expect(wheelZoomFactor(5000)).toBe(wheelZoomFactor(100));
  });

  test("fit centres the bounds in the open area and respects the cap", () => {
    const viewport = { w: 1000, h: 800 };
    const insets = { top: 0, right: 0, bottom: 0, left: 200 };
    const bounds = { x: 0, y: 0, w: 400, h: 200 };
    const cam = fitBounds(bounds, viewport, insets, { margin: 50 });
    // Open area is 800 - 100 wide and 800 - 100 tall; width binds: 700 / 400.
    close(cam.z, 700 / 400);
    const centre = worldToScreen(cam, { x: 200, y: 100 });
    close(centre.x, 200 + 50 + 350);
    close(centre.y, 400);
    expect(fitBounds(bounds, viewport, insets, { margin: 50, maxZoom: 1 }).z).toBe(1);
  });

  test("centerOn and viewCenter agree", () => {
    const viewport = { w: 1440, h: 900 };
    const insets = { top: 66, right: 0, bottom: 62, left: 304 };
    const cam = centerOn({ x: 500, y: -300 }, 0.5, viewport, insets);
    const c = viewCenter(cam, viewport, insets);
    close(c.x, 500);
    close(c.y, -300);
  });

  test("labels and transforms", () => {
    expect(zoomLabel(0.5)).toBe("50%");
    expect(zoomLabel(0.123)).toBe("12%");
    expect(cameraTransform({ x: 1, y: 2, z: 3 })).toBe("translate(1px, 2px) scale(3)");
  });
});
