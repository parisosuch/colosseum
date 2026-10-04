// Camera moves shared by the keyboard, the zoom island and the first load.

import {
  centerOn,
  fitBounds,
  stepZoom,
  viewCenter,
  zoomAt,
  type Camera,
  type Point,
} from "@/lib/canvas/camera";
import {
  cameraBetween,
  cubicBezier,
  DURATION_PANEL_MS,
  EASE_OUT,
  parseCubicBezier,
  parseDuration,
} from "@/lib/canvas/camera-motion";
import { unionRects } from "@/lib/canvas/geometry";
import type { CanvasStore } from "./canvas-store";

// The middle of the part of the viewport the floating chrome leaves open, in
// screen space.
function openCentre(store: CanvasStore): Point {
  const { viewport: v, insets: i } = store;
  return { x: i.left + (v.w - i.left - i.right) / 2, y: i.top + (v.h - i.top - i.bottom) / 2 };
}

export function zoomStep(store: CanvasStore, direction: 1 | -1, at?: Point): void {
  const z = stepZoom(store.camera.z, direction);
  store.setCamera(zoomAt(store.camera, at ?? openCentre(store), z));
}

// shift+0: 100%, keeping whatever is in the middle of the view there.
export function zoomToActual(store: CanvasStore): void {
  const centre = viewCenter(store.camera, store.viewport, store.insets);
  store.setCamera(centerOn(centre, 1, store.viewport, store.insets));
}

// shift+1: frame everything on the canvas. An empty canvas goes to 100% at the
// origin.
export function zoomToFit(store: CanvasStore, maxZoom?: number): void {
  const bounds = unionRects(store.docState.boxes.map((b) => b.rect));
  if (!bounds) {
    store.setCamera(centerOn({ x: 0, y: 0 }, 1, store.viewport, store.insets));
    return;
  }
  store.setCamera(fitBounds(bounds, store.viewport, store.insets, { maxZoom }));
}

// Frame a set of elements, for "zoom to selection" (shift+2).
export function zoomToSelection(store: CanvasStore): void {
  const rects = [...store.selection]
    .map((id) => store.docState.boxById.get(id)?.rect)
    .filter((r) => r !== undefined);
  const bounds = unionRects(rects);
  if (bounds) store.setCamera(fitBounds(bounds, store.viewport, store.insets));
}

// The camera move under way, so a new one (or the viewer grabbing the board)
// stops it.
const moving = new WeakMap<CanvasStore, number>();

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// Glide to `to` on --ease-out over --duration-panel. Under reduced motion it
// jumps. A pan or zoom by the viewer mid-move takes over from it.
export function animateCamera(store: CanvasStore, to: Camera): void {
  const frame = moving.get(store);
  if (frame) cancelAnimationFrame(frame);
  moving.delete(store);
  if (reducedMotion()) {
    store.setCamera(to);
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const ease = cubicBezier(parseCubicBezier(css.getPropertyValue("--ease-out")) ?? EASE_OUT);
  const duration = parseDuration(css.getPropertyValue("--duration-panel")) ?? DURATION_PANEL_MS;
  const from = store.camera;
  const viewport = store.viewport;
  const start = performance.now();
  let last = from;
  const step = (now: number) => {
    // Someone else moved the camera: theirs wins.
    if (store.camera !== last) {
      moving.delete(store);
      return;
    }
    const t = Math.min(1, (now - start) / duration);
    last = cameraBetween(from, to, viewport, ease(t));
    store.setCamera(last);
    // setCamera keeps the old object when nothing changed.
    last = store.camera;
    if (t < 1) moving.set(store, requestAnimationFrame(step));
    else moving.delete(store);
  };
  moving.set(store, requestAnimationFrame(step));
}

// Centre the open part of the view on a world point at the current zoom, for
// jumping to a comment thread.
export function centreOn(store: CanvasStore, at: Point, { animate = true } = {}): void {
  const to = centerOn(at, store.camera.z, store.viewport, store.insets);
  if (animate) animateCamera(store, to);
  else store.setCamera(to);
}
