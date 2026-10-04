// The grid setting for this browser: read from localStorage once, written back
// on every change, and shared by every canvas (and every tab, through the
// storage event). The gestures read it to snap, the grid layer to draw. No
// React here, so the gesture tests can load it under react-server.

import {
  GRID_STORAGE_KEY,
  gridStep,
  loadGridSetting,
  parseGridSetting,
  saveGridSetting,
  type GridSetting,
} from "@/lib/canvas/grid";

let current: GridSetting | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function emit() {
  for (const l of listeners) l();
}

export function getGridSetting(): GridSetting {
  if (!current) current = loadGridSetting(storage());
  return current;
}

export function setGridSetting(patch: Partial<GridSetting>): void {
  const prev = getGridSetting();
  const next = { ...prev, ...patch };
  if (next.show === prev.show && next.style === prev.style && next.snap === prev.snap) return;
  current = next;
  saveGridSetting(storage(), next);
  emit();
}

// For tests: forget what was read, so the next read goes back to storage.
export function resetGridSetting(): void {
  current = null;
}

function onStorage(e: StorageEvent) {
  if (e.key !== GRID_STORAGE_KEY) return;
  current = parseGridSetting(e.newValue);
  emit();
}

export function subscribeGridSetting(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

// The world step to snap to at zoom `z`, or null with the grid hidden or
// snapping to it off.
export function snapGridStep(z: number): number | null {
  const { show, snap } = getGridSetting();
  return show && snap ? gridStep(z) : null;
}
