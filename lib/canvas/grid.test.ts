import { describe, expect, test } from "bun:test";

import { MAX_ZOOM, MIN_ZOOM } from "./camera";
import {
  DEFAULT_GRID,
  GRID_BASE,
  GRID_MIN_SPACING,
  GRID_STORAGE_KEY,
  gridDelta,
  gridKeyAction,
  gridOffset,
  gridStep,
  halfStepOpacity,
  loadGridSetting,
  nextGridSetting,
  parseGridSetting,
  saveGridSetting,
  snapToGrid,
} from "./grid";

describe("gridStep", () => {
  test("the design's steps: 64 at 25%, 32 at 50%, 16 at 100%, the 8 base from 150% up", () => {
    expect(gridStep(0.25)).toBe(64);
    expect(gridStep(0.5)).toBe(32);
    expect(gridStep(1)).toBe(16);
    expect(gridStep(1.5)).toBe(8);
    expect(gridStep(2)).toBe(8);
    expect(gridStep(4)).toBe(8);
    expect(gridStep(MAX_ZOOM)).toBe(8);
  });

  test("10%: 128 world units, 12.8px on screen", () => {
    expect(gridStep(0.1)).toBe(128);
    expect(gridStep(0.1) * 0.1).toBeCloseTo(12.8);
  });

  test("never under 12px apart on screen from 5% to 800%, and under 24px below 150%", () => {
    for (let z = MIN_ZOOM; z <= MAX_ZOOM; z *= 1.03) {
      const step = gridStep(z);
      const onScreen = step * z;
      expect(onScreen).toBeGreaterThanOrEqual(GRID_MIN_SPACING - 1e-9);
      // Below 150% the step doubles, so the spacing stays under twice the
      // minimum; above it the 8-unit base just grows with the zoom.
      if (z < 1.5) expect(onScreen).toBeLessThan(GRID_MIN_SPACING * 2);
      expect(step % GRID_BASE).toBe(0);
    }
    // 32px at 400%, as designed.
    expect(gridStep(4) * 4).toBe(32);
  });

  test("a bad zoom falls back to the base", () => {
    expect(gridStep(0)).toBe(8);
    expect(gridStep(Number.NaN)).toBe(8);
  });
});

describe("halfStepOpacity", () => {
  test("0 just after the step doubles, rising to 1 as it's about to halve", () => {
    // 75%: 16 units are 12px apart, the step just doubled from 8.
    expect(halfStepOpacity(0.75)).toBe(0);
    expect(halfStepOpacity(1)).toBeCloseTo(1 / 3);
    expect(halfStepOpacity(1.49)).toBeGreaterThan(0.95);
    // At the base step there's nothing finer to fade in.
    expect(halfStepOpacity(1.5)).toBe(0);
    expect(halfStepOpacity(4)).toBe(0);
  });

  test("continuous through every halving: the marks are full strength as they become the grid", () => {
    for (let z = MIN_ZOOM; z < 1.5; z *= 1.01) {
      const next = z * 1.01;
      if (gridStep(next) < gridStep(z) && gridStep(next) > GRID_BASE) {
        expect(halfStepOpacity(z)).toBeGreaterThan(0.95);
        expect(halfStepOpacity(next)).toBeLessThan(0.05);
      }
    }
  });
});

describe("snapToGrid and gridOffset", () => {
  test("rounds to the nearest line, both signs", () => {
    expect(snapToGrid(13, 8)).toBe(16);
    expect(snapToGrid(11.9, 8)).toBe(8);
    expect(snapToGrid(-13, 8)).toBe(-16);
    expect(snapToGrid(-3, 8)).toBe(0);
    expect(Object.is(snapToGrid(-3, 8), -0)).toBe(false);
    expect(snapToGrid(70, 128)).toBe(128);
    expect(gridDelta(13, 8)).toBe(3);
  });

  test("the pattern's offset stays in [0, spacing) for any camera", () => {
    expect(gridOffset(0, 8)).toBe(0);
    expect(gridOffset(20, 8)).toBe(4);
    expect(gridOffset(-20, 8)).toBe(4);
    expect(gridOffset(-16, 8)).toBe(0);
    expect(gridOffset(3.5, 12.8)).toBeCloseTo(3.5);
  });
});

describe("the setting", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  }

  test("off, in dots, with snapping on, until set", () => {
    expect(loadGridSetting(memoryStorage())).toEqual(DEFAULT_GRID);
    expect(loadGridSetting(null)).toEqual({ show: false, style: "dots", snap: true });
  });

  test("survives a reload: what's saved is what the next load reads", () => {
    const storage = memoryStorage();
    saveGridSetting(storage, { show: true, style: "lines", snap: false });
    expect(storage.data.get(GRID_STORAGE_KEY)).toBe('{"show":true,"style":"lines","snap":false}');
    expect(loadGridSetting(storage)).toEqual({ show: true, style: "lines", snap: false });
  });

  test("bad or foreign values fall back", () => {
    expect(parseGridSetting("not json")).toEqual(DEFAULT_GRID);
    expect(parseGridSetting("null")).toEqual(DEFAULT_GRID);
    expect(parseGridSetting('{"show":"yes","style":"hex"}')).toEqual(DEFAULT_GRID);
    expect(parseGridSetting('{"show":true}')).toEqual({ show: true, style: "dots", snap: true });
  });

  test("storage that throws (blocked site data) is ignored", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadGridSetting(throwing)).toEqual(DEFAULT_GRID);
    expect(() => saveGridSetting(throwing, DEFAULT_GRID)).not.toThrow();
  });

  test("the keys: shift+' shows the grid, shift+cmd/ctrl+' toggles snapping", () => {
    const key = (o: Partial<Parameters<typeof gridKeyAction>[0]>) =>
      gridKeyAction({
        code: "Quote",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        ...o,
      });
    expect(key({})).toBe("show");
    expect(key({ metaKey: true })).toBe("snap");
    expect(key({ ctrlKey: true })).toBe("snap");
    expect(key({ shiftKey: false })).toBeNull();
    expect(key({ shiftKey: false, metaKey: true })).toBeNull();
    expect(key({ altKey: true })).toBeNull();
    expect(key({ code: "KeyG" })).toBeNull();

    expect(nextGridSetting(DEFAULT_GRID, "show")).toEqual({ ...DEFAULT_GRID, show: true });
    expect(nextGridSetting({ show: true, style: "lines", snap: true }, "show")).toEqual({
      show: false,
      style: "lines",
      snap: true,
    });
    expect(nextGridSetting(DEFAULT_GRID, "snap")).toEqual({ ...DEFAULT_GRID, snap: false });
  });
});
