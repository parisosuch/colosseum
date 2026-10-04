import { afterEach, beforeEach, expect, test } from "bun:test";

import { GRID_STORAGE_KEY } from "@/lib/canvas/grid";
import {
  getGridSetting,
  resetGridSetting,
  setGridSetting,
  snapGridStep,
  subscribeGridSetting,
} from "./grid-setting";

// A browser's localStorage and storage event, for the length of a test.
let data: Map<string, string>;
let storageListeners: Set<(e: StorageEvent) => void>;
const g = globalThis as { window?: unknown };

beforeEach(() => {
  data = new Map();
  storageListeners = new Set();
  g.window = {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    },
    addEventListener: (type: string, fn: (e: StorageEvent) => void) => {
      if (type === "storage") storageListeners.add(fn);
    },
    removeEventListener: (type: string, fn: (e: StorageEvent) => void) => {
      if (type === "storage") storageListeners.delete(fn);
    },
  };
  resetGridSetting();
});

afterEach(() => {
  delete g.window;
  resetGridSetting();
});

test("off until turned on, and written to localStorage when it is", () => {
  expect(getGridSetting()).toEqual({ show: false, style: "dots", snap: true });
  setGridSetting({ show: true, style: "lines" });
  expect(JSON.parse(data.get(GRID_STORAGE_KEY)!)).toEqual({
    show: true,
    style: "lines",
    snap: true,
  });
});

test("survives a reload", () => {
  setGridSetting({ show: true, style: "lines", snap: false });
  // A reload: the module's copy is gone and the next read goes to storage.
  resetGridSetting();
  expect(getGridSetting()).toEqual({ show: true, style: "lines", snap: false });
});

test("a browser with nothing stored (another person's) starts with it off", () => {
  setGridSetting({ show: true });
  data.clear();
  resetGridSetting();
  expect(getGridSetting().show).toBe(false);
});

test("subscribers hear changes, and another tab's change arrives by the storage event", () => {
  let heard = 0;
  const off = subscribeGridSetting(() => heard++);
  setGridSetting({ show: true });
  // No change, no notification.
  setGridSetting({ show: true });
  expect(heard).toBe(1);
  for (const fn of storageListeners) {
    fn({
      key: GRID_STORAGE_KEY,
      newValue: '{"show":false,"style":"lines","snap":true}',
    } as StorageEvent);
  }
  expect(heard).toBe(2);
  expect(getGridSetting()).toEqual({ show: false, style: "lines", snap: true });
  off();
  expect(storageListeners.size).toBe(0);
});

test("the snap step follows the setting and the zoom", () => {
  expect(snapGridStep(1)).toBeNull();
  setGridSetting({ show: true });
  expect(snapGridStep(1)).toBe(16);
  expect(snapGridStep(2)).toBe(8);
  expect(snapGridStep(0.1)).toBe(128);
  // Snapping off: the grid shows and nothing snaps to it.
  setGridSetting({ snap: false });
  expect(snapGridStep(1)).toBeNull();
});
