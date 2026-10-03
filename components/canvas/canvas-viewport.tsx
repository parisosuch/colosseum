"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  cameraTransform,
  panBy,
  screenToWorld,
  visibleWorldRect,
  wheelPixels,
  wheelZoomFactor,
  worldRectToScreen,
  zoomAt,
  type Camera,
  type Point,
  type Rect,
} from "@/lib/canvas/camera";
import { BLOCK_MIN_SIZE, removeElements, setGeometry } from "@/lib/canvas/elements";
import {
  HANDLE_CURSOR,
  cullBoxes,
  expandRect,
  hitHandle,
  hitTest,
  marqueeHits,
  needsRecull,
  normalizeRect,
  nudgeDelta,
  pastThreshold,
  resizeRect,
  scaleRects,
  unionRects,
  type Handle,
} from "@/lib/canvas/geometry";
import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { zoomStep, zoomToActual, zoomToFit, zoomToSelection } from "./camera-actions";
import { CanvasBlock } from "./canvas-block";
import { CanvasOverlay, HANDLE_SIZE } from "./canvas-overlay";
import type { CanvasStore } from "./canvas-store";
import { useCanvas } from "./use-canvas";

export type Tool = "select" | "hand";

// The MIME type a sidebar block carries while it's dragged onto the canvas.
export const BLOCK_DRAG_TYPE = "application/x-colosseum-block";

// How long after the last wheel or drag event a gesture counts as over, and
// `will-change` comes off so the browser re-rasterizes text at the new scale.
const GESTURE_IDLE_MS = 150;

// The lowest zoom at which a camera gesture sets `will-change: transform`. 0
// means always, as the issue asks. Headless Chrome on software raster panned 500
// blocks at 5-18fps below 100% with the hint and ~60fps without (see the PR),
// so raise this to 1 if GPU hardware shows the same.
const WILL_CHANGE_MIN_ZOOM = 0;

// A tap on a phone: under this long and this far.
const TAP_MS = 350;
const TAP_SLOP = 8;

type Gesture =
  | { kind: "pan"; pointerId: number; last: Point }
  | {
      kind: "move";
      pointerId: number;
      start: Point;
      moving: boolean;
      // Stored (parent-relative) positions at the start, per element.
      origins: Map<string, Point>;
      // A press on an already-selected block in a multi-selection: if it never
      // becomes a move, the release selects only that block.
      collapseTo: string | null;
    }
  | {
      kind: "marquee";
      pointerId: number;
      start: Point;
      startWorld: Point;
      active: boolean;
      base: Set<string>;
    }
  | {
      kind: "resize";
      pointerId: number;
      handle: Handle;
      start: Point;
      bounds: Rect;
      // World rects and stored offsets (stored = world - offset) at the start.
      items: { id: string; world: Rect; offset: Point }[];
    };

type TouchGesture = {
  points: Map<number, Point>;
  startCamera: Camera;
  startMid: Point;
  startDist: number;
  tapStart: { at: Point; time: number } | null;
};

export function CanvasViewport({
  store,
  columns,
  screenshots,
  editing,
  touchOnly,
  tool,
  onToolChange,
  onOpenBlock,
  onPlaceBlock,
  ready,
}: {
  store: CanvasStore;
  columns: ReadonlyMap<number, Column | null>;
  screenshots: ReadonlyMap<string, ColumnScreenshot>;
  // Selection, moves, resizes and drops. Off for read-only viewers and phones.
  editing: boolean;
  // A phone or tablet: one finger pans, two pinch, a tap opens a block.
  touchOnly: boolean;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onOpenBlock: (columnId: number) => void;
  onPlaceBlock: (columnId: number, at: Point) => void;
  // Whether the board has its blocks and opening camera. The world stays
  // hidden until then and fades in, rather than its cards appearing one batch
  // at a time under the loader.
  ready: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const doc = useCanvas(store, "doc", (s) => s.docState);

  // The latest props, for the native listeners registered once below.
  const props = useRef({ editing, touchOnly, tool, onToolChange, onOpenBlock, onPlaceBlock });
  useLayoutEffect(() => {
    props.current = { editing, touchOnly, tool, onToolChange, onOpenBlock, onPlaceBlock };
  });

  const [visible, setVisible] = useState<ReadonlySet<string>>(() => new Set());
  const [cursor, setCursor] = useState<string>("default");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dropping, setDropping] = useState(false);

  // --- camera → DOM, culling, will-change ---
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    let culledFor: Rect | null = null;
    let culledAtZoom = 0;
    let idle: ReturnType<typeof setTimeout> | null = null;

    const recull = (force: boolean) => {
      const { viewport, camera } = store;
      if (viewport.w === 0) return;
      const view = visibleWorldRect(camera, viewport);
      const margin = Math.max(view.w, view.h) * 0.5;
      const zoomedFar =
        culledAtZoom > 0 && (camera.z / culledAtZoom > 2 || culledAtZoom / camera.z > 2);
      if (!force && !zoomedFar && !needsRecull(culledFor, view, margin * 0.5)) return;
      culledFor = expandRect(view, margin);
      culledAtZoom = camera.z;
      setVisible(cullBoxes(store.docState.boxes, view, margin));
    };

    const applyCamera = () => {
      world.style.transform = cameraTransform(store.camera);
      // While the camera moves, the world gets its own compositor layer so a
      // pan is a re-composite instead of a repaint, and the hint comes off once
      // the gesture stops so text is re-rasterized sharp at the new scale.
      if (store.camera.z >= WILL_CHANGE_MIN_ZOOM) {
        if (world.style.willChange !== "transform") world.style.willChange = "transform";
      } else if (world.style.willChange === "transform") {
        world.style.willChange = "auto";
      }
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => {
        world.style.willChange = "auto";
        idle = null;
      }, GESTURE_IDLE_MS);
      recull(false);
    };

    world.style.transform = cameraTransform(store.camera);
    recull(true);
    const offCamera = store.subscribe("camera", applyCamera);
    const offDoc = store.subscribe("doc", () => recull(true));
    const viewport = viewportRef.current!;
    const ro = new ResizeObserver(() => {
      store.viewport = { w: viewport.clientWidth, h: viewport.clientHeight };
      recull(true);
    });
    ro.observe(viewport);
    store.viewport = { w: viewport.clientWidth, h: viewport.clientHeight };
    return () => {
      offCamera();
      offDoc();
      ro.disconnect();
      if (idle) clearTimeout(idle);
    };
  }, [store]);

  // --- pointer, wheel, gesture and keyboard input ---
  useEffect(() => {
    const el = viewportRef.current!;
    let gesture: Gesture | null = null;
    let touch: TouchGesture | null = null;
    let space = false;
    let frame = 0;
    let pendingMove: (() => void) | null = null;

    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const toWorld = (p: Point) => screenToWorld(store.camera, p);

    // Writes during a drag are batched to one per frame.
    const schedule = (fn: () => void) => {
      pendingMove = fn;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const run = pendingMove;
        pendingMove = null;
        run?.();
      });
    };
    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const run = pendingMove;
      pendingMove = null;
      run?.();
    };

    const selectionBounds = (): Rect | null =>
      unionRects(
        [...store.selection]
          .map((id) => store.docState.boxById.get(id)?.rect)
          .filter((r) => r !== undefined),
      );

    const panning = () => space || props.current.tool === "hand";

    const updateHoverCursor = (p: Point) => {
      if (panning()) return setCursor("grab");
      if (!props.current.editing) return setCursor("default");
      const b = selectionBounds();
      const h = b ? hitHandle(worldRectToScreen(store.camera, b), p, HANDLE_SIZE) : null;
      setCursor(h ? HANDLE_CURSOR[h] : "default");
    };

    const blockAt = (world: Point): string | null => hitTest(store.docState.boxes, world);
    const columnOf = (id: string) => store.docState.elements.get(id)?.columnId ?? null;

    // ----- mouse and pen -----
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || props.current.touchOnly) return onTouchDown(e);
      // No text selection or native drag from a press on the board.
      e.preventDefault();
      el.focus({ preventScroll: true });
      const p = local(e);
      if (
        e.button === 1 ||
        (e.button === 0 && panning()) ||
        (e.button === 0 && !props.current.editing)
      ) {
        e.preventDefault();
        gesture = { kind: "pan", pointerId: e.pointerId, last: p };
        el.setPointerCapture(e.pointerId);
        setCursor("grabbing");
        return;
      }
      if (e.button !== 0) return;
      const world = toWorld(p);

      const bounds = selectionBounds();
      if (bounds) {
        const handle = hitHandle(worldRectToScreen(store.camera, bounds), p, HANDLE_SIZE);
        if (handle) {
          const items = [...store.selection].flatMap((id) => {
            const box = store.docState.boxById.get(id);
            const snap = store.docState.elements.get(id);
            if (!box || !snap) return [];
            return [
              { id, world: box.rect, offset: { x: box.rect.x - snap.x, y: box.rect.y - snap.y } },
            ];
          });
          gesture = { kind: "resize", pointerId: e.pointerId, handle, start: p, bounds, items };
          el.setPointerCapture(e.pointerId);
          return;
        }
      }

      const hit = blockAt(world);
      if (hit) {
        let collapseTo: string | null = null;
        if (e.shiftKey) {
          const next = new Set(store.selection);
          if (next.has(hit)) next.delete(hit);
          else next.add(hit);
          store.setSelection(next);
          if (!next.has(hit)) return;
        } else if (!store.selection.has(hit)) {
          store.setSelection([hit]);
        } else if (store.selection.size > 1) {
          collapseTo = hit;
        }
        const origins = new Map<string, Point>();
        for (const id of store.selection) {
          const snap = store.docState.elements.get(id);
          if (snap && !snap.locked) origins.set(id, { x: snap.x, y: snap.y });
        }
        gesture = {
          kind: "move",
          pointerId: e.pointerId,
          start: p,
          moving: false,
          origins,
          collapseTo,
        };
      } else {
        const base = e.shiftKey ? new Set(store.selection) : new Set<string>();
        if (!e.shiftKey) store.setSelection([]);
        gesture = {
          kind: "marquee",
          pointerId: e.pointerId,
          start: p,
          startWorld: world,
          active: false,
          base,
        };
      }
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || props.current.touchOnly) return onTouchMove(e);
      const p = local(e);
      if (props.current.editing) store.setCursor(toWorld(p));
      if (!gesture || gesture.pointerId !== e.pointerId) {
        updateHoverCursor(p);
        return;
      }
      const g = gesture;
      if (g.kind === "pan") {
        store.setCamera(panBy(store.camera, p.x - g.last.x, p.y - g.last.y));
        g.last = p;
      } else if (g.kind === "move") {
        if (!g.moving && !pastThreshold(g.start, p)) return;
        g.moving = true;
        const dx = (p.x - g.start.x) / store.camera.z;
        const dy = (p.y - g.start.y) / store.camera.z;
        schedule(() =>
          setGeometry(
            store.doc,
            [...g.origins].map(([id, o]) => ({ id, x: o.x + dx, y: o.y + dy })),
            store.origin,
          ),
        );
      } else if (g.kind === "marquee") {
        if (!g.active && !pastThreshold(g.start, p)) return;
        g.active = true;
        const rect = normalizeRect(g.startWorld, toWorld(p));
        store.setMarquee(rect);
        store.setSelection([...g.base, ...marqueeHits(store.docState.boxes, rect)]);
      } else if (g.kind === "resize") {
        const dx = (p.x - g.start.x) / store.camera.z;
        const dy = (p.y - g.start.y) / store.camera.z;
        const single = g.items.length === 1;
        const next = resizeRect(g.bounds, g.handle, dx, dy, {
          keepAspect: e.shiftKey,
          min: single ? BLOCK_MIN_SIZE : { w: 8, h: 8 },
        });
        const rects = single
          ? [next]
          : scaleRects(
              g.items.map((i) => i.world),
              g.bounds,
              next,
            );
        schedule(() =>
          setGeometry(
            store.doc,
            g.items.map((item, i) => ({
              id: item.id,
              x: rects[i].x - item.offset.x,
              y: rects[i].y - item.offset.y,
              w: Math.max(BLOCK_MIN_SIZE.w, rects[i].w),
              h: Math.max(BLOCK_MIN_SIZE.h, rects[i].h),
            })),
            store.origin,
          ),
        );
      }
    };

    const endGesture = (e: PointerEvent) => {
      if (e.pointerType === "touch" || props.current.touchOnly) return onTouchUp(e);
      const g = gesture;
      if (!g || g.pointerId !== e.pointerId) return;
      gesture = null;
      flush();
      if (g.kind === "move" && !g.moving && g.collapseTo && !e.shiftKey) {
        store.setSelection([g.collapseTo]);
      }
      if (g.kind === "marquee") store.setMarquee(null);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      updateHoverCursor(local(e));
    };

    const onPointerLeave = () => {
      if (!gesture) store.setCursor(null);
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (props.current.touchOnly) return;
      const hit = blockAt(toWorld(local(e)));
      const columnId = hit ? columnOf(hit) : null;
      if (columnId != null) props.current.onOpenBlock(columnId);
    };

    // ----- touch: view-only -----
    const startTouch = (points: Map<number, Point>): TouchGesture => {
      const pts = [...points.values()];
      const mid =
        pts.length >= 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
      const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
      return { points, startCamera: store.camera, startMid: mid, startDist: dist, tapStart: null };
    };

    const onTouchDown = (e: PointerEvent) => {
      const points = new Map(touch?.points ?? []);
      points.set(e.pointerId, local(e));
      const tapStart = points.size === 1 ? { at: local(e), time: performance.now() } : null;
      touch = { ...startTouch(points), tapStart };
      el.setPointerCapture(e.pointerId);
    };

    const onTouchMove = (e: PointerEvent) => {
      if (!touch || !touch.points.has(e.pointerId)) return;
      touch.points.set(e.pointerId, local(e));
      const pts = [...touch.points.values()];
      if (pts.length >= 2 && touch.startDist > 0) {
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const zoomed = zoomAt(
          touch.startCamera,
          touch.startMid,
          touch.startCamera.z * (dist / touch.startDist),
        );
        store.setCamera(panBy(zoomed, mid.x - touch.startMid.x, mid.y - touch.startMid.y));
      } else if (pts.length === 1) {
        store.setCamera(
          panBy(touch.startCamera, pts[0].x - touch.startMid.x, pts[0].y - touch.startMid.y),
        );
      }
    };

    const onTouchUp = (e: PointerEvent) => {
      if (!touch) return;
      const t = touch;
      const at = local(e);
      t.points.delete(e.pointerId);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (t.tapStart && t.points.size === 0) {
        const quick = performance.now() - t.tapStart.time < TAP_MS;
        const still = Math.hypot(at.x - t.tapStart.at.x, at.y - t.tapStart.at.y) < TAP_SLOP;
        if (quick && still) {
          const hit = blockAt(toWorld(at));
          const columnId = hit ? columnOf(hit) : null;
          if (columnId != null) props.current.onOpenBlock(columnId);
        }
      }
      // Lifting one finger of a pinch carries on as a one-finger pan from
      // where the camera is now.
      touch = t.points.size > 0 ? startTouch(t.points) : null;
    };

    // ----- wheel and Safari's gesture events -----
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) {
        const factor = wheelZoomFactor(wheelPixels(e.deltaY, e.deltaMode));
        store.setCamera(zoomAt(store.camera, p, store.camera.z * factor));
        return;
      }
      let dx = wheelPixels(e.deltaX, e.deltaMode);
      let dy = wheelPixels(e.deltaY, e.deltaMode);
      // A mouse wheel with shift scrolls sideways.
      if (e.shiftKey && dx === 0) {
        dx = dy;
        dy = 0;
      }
      store.setCamera(panBy(store.camera, -dx, -dy));
    };

    let gestureStartZoom = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStartZoom = store.camera.z;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      store.setCamera(zoomAt(store.camera, local(g), gestureStartZoom * g.scale));
    };

    // ----- keyboard -----
    const isTyping = (target: EventTarget | null) => {
      const t = target as HTMLElement | null;
      if (!t) return false;
      return (
        t.isContentEditable ||
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT"
      );
    };
    const dialogOpen = () =>
      document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || dialogOpen()) return;
      const onControl = (e.target as HTMLElement | null)?.closest?.(
        "button, a, [role=button], [role=menuitem], [role=tab]",
      );
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === " " && !onControl) {
        e.preventDefault();
        if (!space) {
          space = true;
          setSpaceHeld(true);
          if (!gesture) setCursor("grab");
        }
        return;
      }
      if (mod) {
        if (e.key === "a" && props.current.editing) {
          e.preventDefault();
          store.setSelection(store.docState.boxes.map((b) => b.id));
        }
        return;
      }
      if (e.altKey) return;
      if (e.code === "Digit1" && e.shiftKey) {
        e.preventDefault();
        zoomToFit(store);
        return;
      }
      if (e.code === "Digit0" && e.shiftKey) {
        e.preventDefault();
        zoomToActual(store);
        return;
      }
      if (e.code === "Digit2" && e.shiftKey) {
        e.preventDefault();
        zoomToSelection(store);
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomStep(store, 1);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomStep(store, -1);
        return;
      }
      if (props.current.touchOnly) return;
      if (e.key === "v" || e.key === "V") return props.current.onToolChange("select");
      if (e.key === "h" || e.key === "H") return props.current.onToolChange("hand");
      if (e.key === "Escape") {
        store.setSelection([]);
        return;
      }
      if (onControl) return;
      if (e.key === "Enter" && store.selection.size === 1) {
        const [id] = store.selection;
        const columnId = columnOf(id);
        if (columnId != null) {
          e.preventDefault();
          props.current.onOpenBlock(columnId);
        }
        return;
      }
      if (!props.current.editing || store.selection.size === 0) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeElements(store.doc, [...store.selection], store.origin);
        store.setSelection([]);
        return;
      }
      const nudge = nudgeDelta(e.key, e.shiftKey);
      if (nudge) {
        e.preventDefault();
        setGeometry(
          store.doc,
          [...store.selection].flatMap((id) => {
            const snap = store.docState.elements.get(id);
            return snap && !snap.locked ? [{ id, x: snap.x + nudge.x, y: snap.y + nudge.y }] : [];
          }),
          store.origin,
        );
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && space) {
        space = false;
        setSpaceHeld(false);
        if (!gesture) setCursor(props.current.tool === "hand" ? "grab" : "default");
      }
    };
    const onBlur = () => {
      space = false;
      setSpaceHeld(false);
    };

    // ----- drop from the sidebar -----
    const carriesBlock = (e: DragEvent) => e.dataTransfer?.types.includes(BLOCK_DRAG_TYPE) ?? false;
    const onDragOver = (e: DragEvent) => {
      if (!props.current.editing || !carriesBlock(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDropping(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null || !el.contains(e.relatedTarget as Node)) setDropping(false);
    };
    const onDrop = (e: DragEvent) => {
      setDropping(false);
      if (!props.current.editing || !carriesBlock(e)) return;
      e.preventDefault();
      const id = Number(e.dataTransfer?.getData(BLOCK_DRAG_TYPE));
      if (Number.isSafeInteger(id)) props.current.onPlaceBlock(id, toWorld(local(e)));
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endGesture);
    el.addEventListener("pointercancel", endGesture);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("dblclick", onDoubleClick);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endGesture);
      el.removeEventListener("pointercancel", endGesture);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("dblclick", onDoubleClick);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [store]);

  const shownCursor =
    tool === "hand" && cursor === "default"
      ? "grab"
      : spaceHeld && cursor === "default"
        ? "grab"
        : cursor;

  return (
    <div
      ref={viewportRef}
      // The board takes keyboard focus for its shortcuts (arrows, delete,
      // zoom), like any other application surface.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="application"
      aria-label="Canvas"
      aria-roledescription="canvas"
      data-vt="board"
      className="absolute inset-0 touch-none select-none overflow-hidden bg-canvas-surface outline-none"
      style={{ cursor: shownCursor }}
    >
      <div
        ref={worldRef}
        className={`pointer-events-none absolute left-0 top-0 origin-top-left transition-opacity duration-ui ease-out ${ready ? "opacity-100" : "opacity-0"}`}
      >
        {doc.ordered.map((el) => {
          if (!visible.has(el.id)) return null;
          const box = doc.boxById.get(el.id);
          if (!box || el.columnId == null) return null;
          const column = columns.get(el.columnId);
          return (
            <CanvasBlock
              key={el.id}
              rect={box.rect}
              column={column}
              screenshot={column?.url ? screenshots.get(column.url) : undefined}
            />
          );
        })}
        {/* Vector elements (pen, shapes, connectors) render here, in the same
            world transform, so they stay sharp at any zoom. */}
        <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden />
      </div>
      <CanvasOverlay store={store} showHandles={editing} />
      {dropping ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: "hsl(var(--foreground) / var(--canvas-wash-alpha))" }}
        />
      ) : null}
    </div>
  );
}
