// The canvas grid: a personal view setting, like zoom. It's kept per browser in
// localStorage and never written to the doc or sent to anyone.
//
// The step is 8 × 2ⁿ world units, the smallest that lands at least
// GRID_MIN_SPACING screen pixels apart: 64 at 25%, 32 at 50%, 16 at 100%, and
// the 8-unit base from 150% up. Below 150% the gap on screen stays between 12
// and 24px; above it the base just grows with the zoom, to 32px at 400%.
// Snapping uses the step that's drawn.

export const GRID_BASE = 8;
// In screen pixels.
export const GRID_MIN_SPACING = 12;

export type GridStyle = "dots" | "lines";
export const GRID_STYLES: readonly GridStyle[] = ["dots", "lines"];

// `snap` only counts while the grid shows.
export type GridSetting = { show: boolean; style: GridStyle; snap: boolean };

export const DEFAULT_GRID: GridSetting = { show: false, style: "dots", snap: true };

export const GRID_STORAGE_KEY = "colosseum:canvas-grid";

// The world step drawn (and snapped to) at zoom `z`.
export function gridStep(z: number): number {
  if (!(z > 0) || !Number.isFinite(z)) return GRID_BASE;
  let step = GRID_BASE;
  // A ceiling on the loop; 2^20 * 8 is far past the 5% minimum zoom.
  for (let i = 0; i < 20 && step * z < GRID_MIN_SPACING; i++) step *= 2;
  return step;
}

// The nearest grid line to `v`.
export function snapToGrid(v: number, step: number): number {
  // `+ 0` turns -0 into 0.
  return Math.round(v / step) * step + 0;
}

// How far `v` has to move to sit on the nearest grid line.
export function gridDelta(v: number, step: number): number {
  return snapToGrid(v, step) - v;
}

// How strongly to draw the half-step marks between the drawn grid's, so that
// zooming in fades them in over the range rather than popping them in when the
// step halves: 0 when the drawn step is GRID_MIN_SPACING apart on screen (it
// just doubled), 1 when the half step reaches GRID_MIN_SPACING (it's about to
// halve, and they become the grid). Always 0 at the base step, which never
// halves.
export function halfStepOpacity(z: number): number {
  const step = gridStep(z);
  if (step <= GRID_BASE) return 0;
  const t = (step * z - GRID_MIN_SPACING) / GRID_MIN_SPACING;
  return Math.min(1, Math.max(0, t));
}

// Where the grid's pattern starts on screen: the offset of the first line
// at or right of (below) the viewport's left (top) edge, in [0, spacing).
export function gridOffset(cameraOffset: number, spacing: number): number {
  const m = cameraOffset % spacing;
  return m < 0 ? m + spacing : m + 0;
}

// The grid keys: shift+' shows or hides the grid, and shift+cmd+' (ctrl off
// a Mac) turns snapping to it on and off. By KeyboardEvent.code, so it's the
// same key whatever shift+' types on the layout.
export type GridKeyAction = "show" | "snap";

export const GRID_KEYS: Record<GridKeyAction, string> = { show: "⇧'", snap: "⇧⌘'" };

export function gridKeyAction(e: {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): GridKeyAction | null {
  if (e.code !== "Quote" || !e.shiftKey || e.altKey) return null;
  return e.metaKey || e.ctrlKey ? "snap" : "show";
}

export function nextGridSetting(prev: GridSetting, action: GridKeyAction): GridSetting {
  return action === "show" ? { ...prev, show: !prev.show } : { ...prev, snap: !prev.snap };
}

export function parseGridSetting(raw: string | null | undefined): GridSetting {
  if (!raw) return DEFAULT_GRID;
  try {
    const v = JSON.parse(raw) as Partial<GridSetting> | null;
    if (!v || typeof v !== "object") return DEFAULT_GRID;
    return {
      show: v.show === true,
      style: GRID_STYLES.includes(v.style as GridStyle) ? (v.style as GridStyle) : "dots",
      snap: v.snap !== false,
    };
  } catch {
    return DEFAULT_GRID;
  }
}

type GridStorage = Pick<Storage, "getItem" | "setItem">;

// Both swallow storage errors (a private window, blocked site data): the grid
// still works for the session, it just isn't remembered.
export function loadGridSetting(storage: GridStorage | null): GridSetting {
  try {
    return parseGridSetting(storage?.getItem(GRID_STORAGE_KEY));
  } catch {
    return DEFAULT_GRID;
  }
}

export function saveGridSetting(storage: GridStorage | null, setting: GridSetting): void {
  try {
    storage?.setItem(GRID_STORAGE_KEY, JSON.stringify(setting));
  } catch {
    // Not remembered; see above.
  }
}
