// The canvas camera. The world layer is drawn with
// `transform: translate(x, y) scale(z)` and `transform-origin: 0 0`, so a world
// point w lands on screen at w * z + (x, y). Screen points here are relative to
// the viewport element's top-left corner, not the window.

export type Camera = { x: number; y: number; z: number };
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

// 5% to 800%. The issue asks for text that stays sharp at 10% and 400%; the
// range runs a step past both so neither is a hard stop.
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, z: 1 };

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: (p.x - camera.x) / camera.z, y: (p.y - camera.y) / camera.z };
}

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: p.x * camera.z + camera.x, y: p.y * camera.z + camera.y };
}

export function worldRectToScreen(camera: Camera, r: Rect): Rect {
  return {
    x: r.x * camera.z + camera.x,
    y: r.y * camera.z + camera.y,
    w: r.w * camera.z,
    h: r.h * camera.z,
  };
}

// The world rectangle the viewport shows.
export function visibleWorldRect(camera: Camera, viewport: { w: number; h: number }): Rect {
  const tl = screenToWorld(camera, { x: 0, y: 0 });
  return { x: tl.x, y: tl.y, w: viewport.w / camera.z, h: viewport.h / camera.z };
}

// Zoom to `z` keeping the world point under the screen point `at` where it is,
// which is what makes ctrl+wheel and pinch zoom "around the pointer".
export function zoomAt(camera: Camera, at: Point, z: number): Camera {
  const next = clampZoom(z);
  const w = screenToWorld(camera, at);
  return { x: at.x - w.x * next, y: at.y - w.y * next, z: next };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x + dx, y: camera.y + dy, z: camera.z };
}

// A wheel event's delta in pixels. Firefox reports mouse wheels in lines.
export function wheelPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * 800;
  return delta;
}

// How much one wheel step zooms. Trackpad pinches arrive as ctrl+wheel with
// small deltas (a few px a frame); a mouse wheel notch is ~100px. The exponent
// makes both feel proportional, and the clamp keeps one notch from jumping
// more than about 2x.
export function wheelZoomFactor(deltaPixels: number): number {
  const d = Math.max(-100, Math.min(100, deltaPixels));
  return Math.exp(-d * 0.0075);
}

// The +/- keys and the zoom buttons step by powers of two around 100%, so
// pressing - from 100% visits 50%, 25%, 12.5%… and + gets back exactly. From an
// in-between level (after a wheel zoom) the first step snaps to the next power.
export function stepZoom(z: number, direction: 1 | -1): number {
  const exp = Math.log2(z);
  const rounded = Math.round(exp);
  const onStep = Math.abs(exp - rounded) < 1e-6;
  const next =
    direction === 1
      ? onStep
        ? rounded + 1
        : Math.ceil(exp)
      : onStep
        ? rounded - 1
        : Math.floor(exp);
  return clampZoom(2 ** next);
}

// Padding kept clear on each side when fitting: the floating islands and the
// blocks panel sit over the board, so "fit" should frame the content in the
// part of the window they leave open.
export type Insets = { top: number; right: number; bottom: number; left: number };

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

// The camera that fits `bounds` into the viewport, inside `insets` plus a
// margin. `maxZoom` caps it, so opening a canvas with one small block doesn't
// blow that block up to 800%.
export function fitBounds(
  bounds: Rect,
  viewport: { w: number; h: number },
  insets: Insets = NO_INSETS,
  { margin = 48, maxZoom = MAX_ZOOM }: { margin?: number; maxZoom?: number } = {},
): Camera {
  const availW = Math.max(1, viewport.w - insets.left - insets.right - margin * 2);
  const availH = Math.max(1, viewport.h - insets.top - insets.bottom - margin * 2);
  const z = clampZoom(
    Math.min(maxZoom, availW / Math.max(1, bounds.w), availH / Math.max(1, bounds.h)),
  );
  const cx = insets.left + margin + availW / 2;
  const cy = insets.top + margin + availH / 2;
  return {
    x: cx - (bounds.x + bounds.w / 2) * z,
    y: cy - (bounds.y + bounds.h / 2) * z,
    z,
  };
}

// The camera that shows `center` (world) in the middle of the open area at `z`.
export function centerOn(
  center: Point,
  z: number,
  viewport: { w: number; h: number },
  insets: Insets = NO_INSETS,
): Camera {
  const zz = clampZoom(z);
  const cx = insets.left + (viewport.w - insets.left - insets.right) / 2;
  const cy = insets.top + (viewport.h - insets.top - insets.bottom) / 2;
  return { x: cx - center.x * zz, y: cy - center.y * zz, z: zz };
}

// The world point in the middle of the open area, where a block added from the
// toolbar lands.
export function viewCenter(
  camera: Camera,
  viewport: { w: number; h: number },
  insets: Insets = NO_INSETS,
): Point {
  return screenToWorld(camera, {
    x: insets.left + (viewport.w - insets.left - insets.right) / 2,
    y: insets.top + (viewport.h - insets.top - insets.bottom) / 2,
  });
}

export function zoomLabel(z: number): string {
  return `${Math.round(z * 100)}%`;
}

export function cameraTransform(camera: Camera): string {
  return `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`;
}
