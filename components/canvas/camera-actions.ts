// Camera moves shared by the keyboard, the zoom island and the first load.

import { centerOn, fitBounds, stepZoom, viewCenter, zoomAt, type Point } from "@/lib/canvas/camera";
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
