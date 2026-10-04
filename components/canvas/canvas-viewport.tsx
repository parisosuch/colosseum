"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
import { setProps } from "@/lib/canvas/elements";
import {
  HANDLE_CURSOR,
  cullBoxes,
  expandRect,
  hitHandle,
  needsRecull,
  nudgeDelta,
  pastThreshold,
} from "@/lib/canvas/geometry";
import { hitLeaf } from "@/lib/canvas/hit";
import { strokePath } from "@/lib/canvas/pen";
import { HIGHLIGHT, inkCss } from "@/lib/canvas/style";
import { moveUpdates } from "@/lib/canvas/transform";
import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import {
  alignSelection,
  deleteSelection,
  distributeSelection,
  duplicate,
  groupSelection,
  redo,
  reorderSelection,
  selectAll,
  selectChildren,
  selectParents,
  undo,
  ungroupSelection,
} from "./actions";
import { zoomStep, zoomToActual, zoomToFit, zoomToSelection } from "./camera-actions";
import { CanvasElement } from "./canvas-element";
import { CanvasGrid } from "./canvas-grid";
import { CanvasOverlay, HANDLE_SIZE } from "./canvas-overlay";
import type { CanvasStore } from "./canvas-store";
import {
  beginGesture,
  doubleClick,
  endGesture,
  moveGesture,
  previewGeom,
  resizeBounds,
  syncConnectorBoxes,
  toolCursor,
  type Gesture,
  type GestureContext,
} from "./gestures";
import { carriesOutsideContent, handleCopy, handleDrop, handlePaste } from "./paste";
import { PastePlaceholders } from "./paste-placeholders";
import { TextEditor } from "./text-editor";
import { toolForKey, VIEWER_TOOLS, type Tool } from "./tools";
import { useCanvas } from "./use-canvas";

export type { Tool } from "./tools";

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

type Pan = { kind: "pan"; last: Point; start: Point; clickable: boolean };
type Active = { pointerId: number; g: Gesture | Pan };

type TouchGesture = {
  points: Map<number, Point>;
  startCamera: Camera;
  startMid: Point;
  startDist: number;
  tapStart: { at: Point; time: number } | null;
};

const BLOCKS_ONLY = { includeLocked: true, types: (e: { type: string }) => e.type === "block" };

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
  onComment,
  onBoardPress,
  ready,
  children,
}: {
  store: CanvasStore;
  columns: ReadonlyMap<number, Column | null>;
  screenshots: ReadonlyMap<string, ColumnScreenshot>;
  // The drawing tools, selection, moves, resizes and drops. Off for read-only
  // viewers and phones.
  editing: boolean;
  // A phone or tablet: one finger pans, two pinch, a tap opens a block.
  touchOnly: boolean;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onOpenBlock: (columnId: number) => void;
  onPlaceBlock: (columnId: number, at: Point) => void;
  // The comment tool's click, in world space.
  onComment: (at: Point) => void;
  // Any press on the board itself, not on a pin or a popover over it.
  onBoardPress?: () => void;
  // Whether the board has its blocks and opening camera. The world stays
  // hidden until then and fades in, rather than its cards appearing one batch
  // at a time under the loader.
  ready: boolean;
  // Screen-space UI drawn over the board that takes its own input: comment
  // pins (marked data-canvas-pin) and the thread popover (data-canvas-ui).
  children?: React.ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const doc = useCanvas(store, "doc", (s) => s.docState);
  const erasing = useCanvas(store, "interaction", (s) => s.erasing);
  const editingText = useCanvas(store, "editing", (s) => s.editing);
  const editingId = editingText && "id" in editingText ? editingText.id : null;

  // The latest props, for the native listeners registered once below.
  const props = useRef({
    editing,
    touchOnly,
    tool,
    onToolChange,
    onOpenBlock,
    onPlaceBlock,
    onComment,
    onBoardPress,
  });
  useLayoutEffect(() => {
    props.current = {
      editing,
      touchOnly,
      tool,
      onToolChange,
      onOpenBlock,
      onPlaceBlock,
      onComment,
      onBoardPress,
    };
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

  // --- pointer, wheel, gesture, keyboard and clipboard input ---
  useEffect(() => {
    const el = viewportRef.current!;
    let active: Active | null = null;
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

    const ctx = (): GestureContext => ({
      store,
      tool: props.current.tool,
      setTool: props.current.onToolChange,
      schedule,
      flush,
      onOpenBlock: props.current.onOpenBlock,
      onComment: props.current.onComment,
    });

    const panning = () => space || props.current.tool === "hand";

    const blockAt = (p: Point): number | null => {
      const hit = hitLeaf(store.hitContext(), toWorld(p), store.camera.z, BLOCKS_ONLY);
      return hit ? (store.docState.elements.get(hit)?.columnId ?? null) : null;
    };

    const updateHoverCursor = (p: Point) => {
      if (panning()) return setCursor("grab");
      const tool = props.current.tool;
      if (!props.current.editing) {
        if (tool === "comment") return setCursor("crosshair");
        // Read-only viewers open blocks with a click and pan with a drag.
        return setCursor(blockAt(p) != null ? "pointer" : "grab");
      }
      if (tool !== "select") return setCursor(toolCursor(tool));
      const b = resizeBounds(store);
      const h = b ? hitHandle(worldRectToScreen(store.camera, b), p, HANDLE_SIZE) : null;
      setCursor(h ? HANDLE_CURSOR[h] : "default");
    };

    const inEditor = (e: Event) =>
      !!(e.target as HTMLElement | null)?.closest?.("[data-canvas-editor]");
    // Comment pins and the thread popover handle their own presses, and the
    // popover scrolls with the wheel instead of panning the board.
    const onPin = (e: Event) =>
      !!(e.target as HTMLElement | null)?.closest?.("[data-canvas-pin], [data-canvas-ui]");
    const inPopover = (e: Event) =>
      !!(e.target as HTMLElement | null)?.closest?.("[data-canvas-ui]");

    // ----- mouse and pen -----
    const onPointerDown = (e: PointerEvent) => {
      if (inEditor(e) || onPin(e)) return;
      props.current.onBoardPress?.();
      if (e.pointerType === "touch" || props.current.touchOnly) return onTouchDown(e);
      // No text selection or native drag from a press on the board.
      e.preventDefault();
      // A press on the board ends typing.
      if (store.editing) (document.activeElement as HTMLElement | null)?.blur();
      el.focus({ preventScroll: true });
      const p = local(e);
      const tool = props.current.tool;
      const viewerSelect = !props.current.editing && tool !== "comment";
      if (e.button === 1 || (e.button === 0 && (panning() || viewerSelect))) {
        active = {
          pointerId: e.pointerId,
          g: {
            kind: "pan",
            last: p,
            start: p,
            clickable: e.button === 0 && viewerSelect && !panning(),
          },
        };
        el.setPointerCapture(e.pointerId);
        setCursor("grabbing");
        return;
      }
      if (e.button !== 0) return;
      // Read-only viewers only get this far with the comment tool.
      if (!props.current.editing && tool !== "comment") return;
      const g = beginGesture(ctx(), e, p);
      if (!g) return;
      active = { pointerId: e.pointerId, g };
      el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || props.current.touchOnly) return onTouchMove(e);
      const p = local(e);
      const w = toWorld(p);
      store.pointer = w;
      if (props.current.editing) store.setCursor(w);
      if (!active || active.pointerId !== e.pointerId) {
        updateHoverCursor(p);
        return;
      }
      const g = active.g;
      if (g.kind === "pan") {
        store.setCamera(panBy(store.camera, p.x - g.last.x, p.y - g.last.y));
        g.last = p;
        return;
      }
      moveGesture(ctx(), g, e, p);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch" || props.current.touchOnly) return onTouchUp(e);
      const a = active;
      if (!a || a.pointerId !== e.pointerId) return;
      active = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      const p = local(e);
      const g = a.g;
      if (g.kind === "pan") {
        if (g.clickable && !pastThreshold(g.start, p)) {
          const columnId = blockAt(p);
          if (columnId != null) props.current.onOpenBlock(columnId);
        }
      } else {
        endGesture(ctx(), g, e, p);
      }
      updateHoverCursor(p);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerType === "touch" || props.current.touchOnly) return onTouchUp(e);
      const a = active;
      if (!a || a.pointerId !== e.pointerId) return;
      active = null;
      flush();
      store.setMarquee(null);
      store.setInteraction({ guides: [], preview: null, erasing: new Set(), bindHover: null });
    };

    const onPointerLeave = () => {
      if (!active) {
        store.setCursor(null);
        store.pointer = null;
      }
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (props.current.touchOnly || inEditor(e) || onPin(e)) return;
      if (!props.current.editing) {
        const columnId = blockAt(local(e));
        if (columnId != null) props.current.onOpenBlock(columnId);
        return;
      }
      if (props.current.tool !== "select") return;
      doubleClick(ctx(), toWorld(local(e)));
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
          const columnId = blockAt(at);
          if (columnId != null) props.current.onOpenBlock(columnId);
        }
      }
      // Lifting one finger of a pinch carries on as a one-finger pan from
      // where the camera is now.
      touch = t.points.size > 0 ? startTouch(t.points) : null;
    };

    // ----- wheel and Safari's gesture events -----
    const onWheel = (e: WheelEvent) => {
      if (inPopover(e) && !(e.ctrlKey || e.metaKey)) return;
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
    // A dialog or menu that takes the keyboard. A comment thread's popover
    // doesn't: tool keys still work with one open, and it handles Escape.
    const dialogOpen = () =>
      [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')].some(
        (d) => !d.closest("[data-canvas-ui]"),
      );

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || dialogOpen()) return;
      // Escape closes an open thread first (ThreadLayer).
      if (e.key === "Escape" && document.querySelector("[data-canvas-ui]")) return;
      const onControl = (e.target as HTMLElement | null)?.closest?.(
        "button, a, [role=button], [role=menuitem], [role=tab], [role=treeitem]",
      );
      const mod = e.metaKey || e.ctrlKey;
      const canEdit = props.current.editing;

      if (e.key === " " && !onControl) {
        e.preventDefault();
        if (!space) {
          space = true;
          setSpaceHeld(true);
          if (!active) setCursor("grab");
        }
        return;
      }
      if (mod) {
        if (!canEdit) return;
        const run = (fn: () => void) => {
          e.preventDefault();
          fn();
        };
        switch (e.code) {
          case "KeyA":
            return run(() => selectAll(store));
          case "KeyZ":
            return run(() => (e.shiftKey ? redo(store) : undo(store)));
          case "KeyY":
            return e.ctrlKey ? run(() => redo(store)) : undefined;
          case "KeyG":
            return run(() => (e.shiftKey ? ungroupSelection(store) : groupSelection(store)));
          case "KeyD":
            return run(() => duplicate(store));
          case "BracketRight":
            return run(() => reorderSelection(store, "forward"));
          case "BracketLeft":
            return run(() => reorderSelection(store, "backward"));
        }
        // Copy, cut and paste arrive as clipboard events below.
        return;
      }
      if (e.altKey) {
        if (!canEdit || store.selection.size === 0) return;
        const align: Record<string, Parameters<typeof alignSelection>[1]> = {
          KeyA: "left",
          KeyD: "right",
          KeyW: "top",
          KeyS: "bottom",
          KeyH: "hcenter",
          KeyV: "vcenter",
        };
        const mode = align[e.code];
        if (mode && !e.shiftKey) {
          e.preventDefault();
          alignSelection(store, mode);
        } else if (e.shiftKey && (e.code === "KeyH" || e.code === "KeyV")) {
          e.preventDefault();
          distributeSelection(store, e.code === "KeyH" ? "x" : "y");
        }
        return;
      }
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
      const picked = toolForKey(e.code, e.shiftKey);
      if (picked) {
        if (!canEdit && !VIEWER_TOOLS.has(picked)) return;
        e.preventDefault();
        props.current.onToolChange(picked);
        return;
      }
      if (e.key === "Escape") {
        if (props.current.tool !== "select") props.current.onToolChange("select");
        else store.setSelection([]);
        return;
      }
      if (onControl) return;
      if (e.key === "Enter" && store.selection.size === 1) {
        const [id] = store.selection;
        const sel = store.docState.elements.get(id);
        if (sel?.columnId != null) {
          e.preventDefault();
          props.current.onOpenBlock(sel.columnId);
          return;
        }
      }
      if (!canEdit || store.selection.size === 0) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) selectParents(store);
        else if (!selectChildren(store) && store.selection.size === 1) {
          const [id] = store.selection;
          const sel = store.docState.elements.get(id);
          if (sel && (sel.type === "text" || sel.type === "sticky")) store.setEditing({ id });
        }
        return;
      }
      if (e.code === "BracketRight") {
        e.preventDefault();
        reorderSelection(store, "front");
        return;
      }
      if (e.code === "BracketLeft") {
        e.preventDefault();
        reorderSelection(store, "back");
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection(store);
        return;
      }
      const nudge = nudgeDelta(e.key, e.shiftKey);
      if (nudge) {
        e.preventDefault();
        setProps(
          store.doc,
          moveUpdates(
            store.docState.elements,
            store.selection,
            nudge.x,
            nudge.y,
            store.docState.layout,
          ),
          store.origin,
        );
        syncConnectorBoxes(store);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && space) {
        space = false;
        setSpaceHeld(false);
        if (!active) setCursor(toolCursor(props.current.tool));
      }
      // Arrow-key nudges held down merge into one undo step; letting go ends it.
      if (e.key.startsWith("Arrow")) store.undo.stopCapturing();
    };
    const onBlur = () => {
      space = false;
      setSpaceHeld(false);
    };

    // ----- clipboard -----
    const clipboardTarget = (e: Event) =>
      !isTyping(e.target) && !dialogOpen() && !props.current.touchOnly && !store.editing;
    const onCopy = (e: ClipboardEvent) => {
      if (clipboardTarget(e)) handleCopy(store, e, false);
    };
    const onCut = (e: ClipboardEvent) => {
      if (clipboardTarget(e) && props.current.editing) handleCopy(store, e, true);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (clipboardTarget(e) && props.current.editing) handlePaste(store, e);
    };

    // ----- drop from the sidebar, or from outside the page -----
    const carriesBlock = (e: DragEvent) => e.dataTransfer?.types.includes(BLOCK_DRAG_TYPE) ?? false;
    const carriesOutside = (e: DragEvent) =>
      !carriesBlock(e) && carriesOutsideContent(e.dataTransfer?.types ?? []);
    const onDragOver = (e: DragEvent) => {
      if (!props.current.editing || !(carriesBlock(e) || carriesOutside(e))) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDropping(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null || !el.contains(e.relatedTarget as Node)) setDropping(false);
    };
    const onDrop = (e: DragEvent) => {
      setDropping(false);
      if (!props.current.editing) return;
      if (carriesOutside(e)) {
        // Taken even when there's nothing to add, or the browser opens the file.
        e.preventDefault();
        handleDrop(store, e, toWorld(local(e)));
        return;
      }
      if (!carriesBlock(e)) return;
      e.preventDefault();
      const id = Number(e.dataTransfer?.getData(BLOCK_DRAG_TYPE));
      if (Number.isSafeInteger(id)) props.current.onPlaceBlock(id, toWorld(local(e)));
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
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
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    window.addEventListener("blur", onBlur);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
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
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("blur", onBlur);
    };
  }, [store]);

  const shownCursor =
    (tool === "hand" || spaceHeld) && (cursor === "default" || cursor === "crosshair")
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
      {touchOnly ? null : <CanvasGrid store={store} />}
      <div
        ref={worldRef}
        className={`pointer-events-none absolute left-0 top-0 origin-top-left transition-opacity duration-ui ease-out ${ready ? "opacity-100" : "opacity-0"}`}
      >
        {doc.ordered.map((el) => {
          if (el.type === "group" || !visible.has(el.id)) return null;
          const geom = doc.layout.geom.get(el.id);
          if (!geom) return null;
          const column = el.columnId != null ? columns.get(el.columnId) : undefined;
          return (
            <CanvasElement
              key={el.id}
              el={el}
              geom={geom}
              column={column}
              screenshot={column?.url ? screenshots.get(column.url) : undefined}
              faded={erasing.has(el.id)}
              editing={editingId === el.id}
            />
          );
        })}
        <PastePlaceholders store={store} />
        <DrawingPreview store={store} />
        <TextEditor store={store} />
      </div>
      <CanvasOverlay store={store} showHandles={editing} />
      {children}
      {dropping ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: "hsl(var(--foreground) / var(--canvas-wash-alpha))" }}
        />
      ) : null}
    </div>
  );
}

// What's being drawn and not written yet: a shape or line, or a pen stroke.
function DrawingPreview({ store }: { store: CanvasStore }) {
  const preview = useCanvas(store, "interaction", (s) => s.preview);
  const style = useCanvas(store, "style", (s) => s.toolStyle);
  const pen = preview?.kind === "pen" ? preview : null;
  const d = useMemo(() => {
    if (!pen) return "";
    const pts: number[] = [];
    for (const p of pen.points) pts.push(p.x, p.y, p.pressure);
    const width = pen.tool === "highlighter" ? style.highlightWidth : style.width;
    return strokePath(pts, width, pen.tool);
  }, [pen, style.width, style.highlightWidth]);
  if (!preview) return null;
  if (preview.kind === "element") {
    const el = preview.element;
    const parent = el.parentId ? store.docState.layout.geom.get(el.parentId) : undefined;
    const parentOrigin = parent ? { x: parent.rect.x, y: parent.rect.y } : { x: 0, y: 0 };
    return <CanvasElement el={el} geom={previewGeom(store, el, parentOrigin)} />;
  }
  if (pen) {
    return (
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={1}
        height={1}
      >
        <path d={d} fill={inkCss(pen.tool === "highlighter" ? HIGHLIGHT : style.stroke)} />
      </svg>
    );
  }
  return null;
}
