// Pointer gestures for editors: select, move, resize, marquee, line-end
// dragging, and every drawing tool. The viewport owns the DOM listeners and
// the camera; it hands mouse and pen presses here once it has ruled out a pan.
//
// Moves, resizes and line-end drags write to the doc as they go (one write per
// frame), so others watch them happen. Shapes, pen strokes and lines are drawn
// as a local preview and written once when the pointer comes up: a stroke is
// one write instead of hundreds of growing point lists.

import {
  screenToWorld,
  visibleWorldRect,
  worldRectToScreen,
  type Point,
  type Rect,
} from "@/lib/canvas/camera";
import { anchorFor } from "@/lib/canvas/connectors";
import {
  clickRect,
  dragRect,
  MIN_DRAG,
  newConnector,
  newFrame,
  newShape,
  newSticky,
  newStroke,
  nextFrameName,
  type ShapeTool,
} from "@/lib/canvas/create";
import {
  BLOCK_MIN_SIZE,
  CONNECTOR_TYPES,
  createElement,
  parentOrigin,
  readElements,
  removeElements,
  setProps,
  snapshotOf,
  withDescendants,
  type ElementSnapshot,
} from "@/lib/canvas/elements";
import {
  DRAG_THRESHOLD,
  containsPoint,
  containsRect,
  hitHandle,
  normalizeRect,
  pastThreshold,
  resizeRect,
  unionRects,
  type Handle,
} from "@/lib/canvas/geometry";
import { bindTarget, eraserHits, hitLeaf, marqueeSelect, selectTarget } from "@/lib/canvas/hit";
import { connectorRoute, type Geom } from "@/lib/canvas/layout";
import { strokeFromInput, type InputPoint } from "@/lib/canvas/pen";
import { SNAP_THRESHOLD, snapPoint, snapRect, type Guide } from "@/lib/canvas/snapping";
import { connectorBoxUpdates, moveUpdates, resizeUpdates } from "@/lib/canvas/transform";
import { frameAt, moveTo, reparentAfterMove, topmostOnly } from "@/lib/canvas/tree";
import { elementsOf, type ConnectorEnd } from "@/lib/realtime/canvas-doc";
import { HANDLE_SIZE } from "./canvas-overlay";
import type { CanvasStore } from "./canvas-store";
import { fitTextElements } from "./measure-text";
import { STICKY_TOOLS, type Tool } from "./tools";

export type GestureContext = {
  store: CanvasStore;
  tool: Tool;
  setTool: (tool: Tool) => void;
  // Run a write at most once per frame, and run the pending one now.
  schedule: (fn: () => void) => void;
  flush: () => void;
  onOpenBlock: (columnId: number) => void;
  onComment: (at: Point) => void;
};

type All = ReadonlyMap<string, ElementSnapshot>;

export type Gesture =
  | {
      kind: "move";
      start: Point;
      moving: boolean;
      ids: string[];
      startAll: All;
      startBounds: Rect | null;
      collapseTo: string | null;
      exclude: Set<string>;
    }
  | { kind: "marquee"; start: Point; startWorld: Point; active: boolean; base: Set<string> }
  | {
      kind: "resize";
      handle: Handle;
      start: Point;
      bounds: Rect;
      ids: string[];
      startAll: All;
      exclude: Set<string>;
    }
  | { kind: "endpoint"; id: string; side: "start" | "end"; moved: boolean }
  | {
      kind: "create";
      tool: ShapeTool | "frame" | "sticky";
      startWorld: Point;
      start: Point;
      parentId: string | null;
      parentOrigin: Point;
      rect: Rect | null;
    }
  | {
      kind: "connector";
      tool: "line" | "arrow";
      startWorld: Point;
      start: Point;
      startEnd: ConnectorEnd;
      startTarget: string | null;
      end: ConnectorEnd | null;
    }
  | {
      kind: "pen";
      tool: "pen" | "highlighter";
      points: InputPoint[];
      parentId: string | null;
      parentOrigin: Point;
    }
  | { kind: "erase"; last: Point; hits: Set<string>; trail: Point[] }
  | { kind: "click"; tool: "text" | "comment"; start: Point; startWorld: Point };

const ENDPOINT_RADIUS = 8;
const TRAIL = 24;

function world(store: CanvasStore, p: Point): Point {
  return screenToWorld(store.camera, p);
}

function selectionBounds(store: CanvasStore): Rect | null {
  return unionRects(
    [...store.selection]
      .map((id) => store.docState.boxById.get(id)?.rect)
      .filter((r): r is Rect => !!r),
  );
}

// The single selected line or arrow, whose ends get their own handles.
export function selectedConnector(store: CanvasStore): ElementSnapshot | null {
  if (store.selection.size !== 1) return null;
  const [id] = store.selection;
  const el = store.docState.elements.get(id);
  return el && CONNECTOR_TYPES.has(el.type) ? el : null;
}

// What resize handles apply to: anything but a lone line or arrow.
export function resizeBounds(store: CanvasStore): Rect | null {
  if (selectedConnector(store)) return null;
  return selectionBounds(store);
}

// Boxes worth snapping to: what's on screen, minus what's moving, lines and
// pen strokes.
function snapTargets(store: CanvasStore, exclude: ReadonlySet<string>): Rect[] {
  const view = visibleWorldRect(store.camera, store.viewport);
  const out: Rect[] = [];
  for (const b of store.docState.boxes) {
    if (exclude.has(b.id)) continue;
    const el = store.docState.elements.get(b.id);
    // Lines and freehand ink are annotation; their boxes would only add
    // noise to the guides.
    if (!el || CONNECTOR_TYPES.has(el.type) || el.type === "stroke") continue;
    const r = b.rect;
    if (r.x > view.x + view.w || r.y > view.y + view.h || r.x + r.w < view.x || r.y + r.h < view.y)
      continue;
    out.push(r);
  }
  return out;
}

function threshold(store: CanvasStore) {
  return SNAP_THRESHOLD / store.camera.z;
}

function originOf(id: string | null, all: All): Point {
  if (!id) return { x: 0, y: 0 };
  const el = all.get(id);
  if (!el) return { x: 0, y: 0 };
  const o = parentOrigin(el, all) ?? { x: 0, y: 0 };
  return { x: o.x + el.x, y: o.y + el.y };
}

// Write each line's box (and the points its bound ends are drawn at) after a
// gesture moved things it's attached to.
export function syncConnectorBoxes(store: CanvasStore) {
  const updates = connectorBoxUpdates(store.docState.elements, store.docState.layout);
  if (updates.length) setProps(store.doc, updates, store.origin);
}

// The anchor for a line end dropped on `rect` at `p`, pulled to the middle of
// an axis when it's close, so arrows between boxes come out straight.
function snappedAnchor(rect: Rect, p: Point) {
  const a = anchorFor(rect, p);
  const near = (v: number) => (Math.abs(v - 0.5) < 0.15 ? 0.5 : v);
  return { ax: near(a.ax), ay: near(a.ay) };
}

function endAt(
  store: CanvasStore,
  p: Point,
  exclude: ReadonlySet<string>,
): { end: ConnectorEnd; target: string | null } {
  const target = bindTarget(store.hitContext(), p, exclude);
  const g = target ? store.docState.layout.geom.get(target) : undefined;
  if (target && g) {
    return { end: { kind: "bound", elementId: target, ...snappedAnchor(g.rect, p) }, target };
  }
  return { end: { kind: "point", x: Math.round(p.x), y: Math.round(p.y) }, target: null };
}

// shift: lines at 45° steps.
function constrain(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

function connectorPreview(
  store: CanvasStore,
  g: Extract<Gesture, { kind: "connector" }>,
): ElementSnapshot | null {
  if (!g.end) return null;
  return snapshotOf(
    "__preview",
    newConnector(g.tool, g.startEnd, g.end, store.toolStyle, {
      parentId: null,
      origin: { x: 0, y: 0 },
      createdBy: store.userId,
    }),
  );
}

export function previewGeom(store: CanvasStore, el: ElementSnapshot, parentOrigin: Point): Geom {
  if (CONNECTOR_TYPES.has(el.type)) {
    const pts = connectorRoute(
      el,
      { x: 0, y: 0 },
      store.docState.elements,
      store.docState.layout.geom,
    );
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const rect = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
    return { rect, origin: { x: 0, y: 0 }, route: pts, clip: null };
  }
  const clip = el.parentId ? (store.docState.layout.geom.get(el.parentId)?.rect ?? null) : null;
  return {
    rect: { x: parentOrigin.x + el.x, y: parentOrigin.y + el.y, w: el.w, h: el.h },
    origin: parentOrigin,
    clip,
  };
}

// ----- press -----

export function beginGesture(ctx: GestureContext, e: PointerEvent, p: Point): Gesture | null {
  const { store, tool } = ctx;
  const w = world(store, p);
  const mod = e.metaKey || e.ctrlKey;
  store.undo.stopCapturing();

  switch (tool) {
    case "select":
      return beginSelect(ctx, e, p, w);
    case "text":
    case "comment":
      return { kind: "click", tool, start: p, startWorld: w };
    case "pen":
    case "highlighter": {
      const all = store.docState.elements;
      const parentId = frameAt(store.docState.layout, all, w, new Set());
      return {
        kind: "pen",
        tool,
        points: [{ x: w.x, y: w.y, pressure: e.pressure }],
        parentId,
        parentOrigin: originOf(parentId, all),
      };
    }
    case "eraser": {
      const hits = new Set(eraserHits(store.hitContext(), w, w, store.camera.z));
      store.setInteraction({ erasing: hits, preview: { kind: "eraser", trail: [w] } });
      return { kind: "erase", last: w, hits, trail: [w] };
    }
    case "rect":
    case "ellipse":
    case "diamond":
    case "frame":
    case "sticky": {
      const all = store.docState.elements;
      const start = mod ? w : snapStart(store, w);
      const parentId = frameAt(store.docState.layout, all, start, new Set());
      return {
        kind: "create",
        tool,
        startWorld: start,
        start: p,
        parentId,
        parentOrigin: originOf(parentId, all),
        rect: null,
      };
    }
    case "line":
    case "arrow": {
      const { end, target } = endAt(store, w, new Set());
      return {
        kind: "connector",
        tool,
        startWorld: w,
        start: p,
        startEnd: end,
        startTarget: target,
        end: null,
      };
    }
    case "hand":
      return null;
  }
}

function snapStart(store: CanvasStore, w: Point): Point {
  const s = snapPoint(w, snapTargets(store, new Set()), threshold(store));
  return { x: w.x + s.dx, y: w.y + s.dy };
}

function beginSelect(ctx: GestureContext, e: PointerEvent, p: Point, w: Point): Gesture | null {
  const { store } = ctx;
  const all = store.docState.elements;

  // A lone line's ends.
  const conn = selectedConnector(store);
  if (conn) {
    const route = store.docState.layout.geom.get(conn.id)?.route;
    if (route && route.length >= 2 && !conn.locked) {
      const ends = [
        ["start", route[0]],
        ["end", route[route.length - 1]],
      ] as const;
      for (const [side, at] of ends) {
        const s = {
          x: at.x * store.camera.z + store.camera.x,
          y: at.y * store.camera.z + store.camera.y,
        };
        if (Math.hypot(s.x - p.x, s.y - p.y) <= ENDPOINT_RADIUS) {
          return { kind: "endpoint", id: conn.id, side, moved: false };
        }
      }
    }
  }

  const bounds = resizeBounds(store);
  if (bounds) {
    const handle = hitHandle(worldRectToScreen(store.camera, bounds), p, HANDLE_SIZE);
    if (handle) {
      const ids = topmostOnly(store.selection, all);
      return {
        kind: "resize",
        handle,
        start: p,
        bounds,
        ids,
        startAll: all,
        exclude: withDescendants(ids, all),
      };
    }
  }

  const leaf = hitLeaf(store.hitContext(), w, store.camera.z);
  const startMove = (collapseTo: string | null): Gesture => {
    const ids = topmostOnly(store.selection, all);
    return {
      kind: "move",
      start: p,
      moving: false,
      ids,
      startAll: all,
      startBounds: selectionBounds(store),
      collapseTo,
      exclude: withDescendants(ids, all),
    };
  };

  if (leaf) {
    const target = selectTarget(leaf, all, store.selection, { deep: e.metaKey || e.ctrlKey });
    let collapseTo: string | null = null;
    if (e.shiftKey) {
      const next = new Set(store.selection);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      store.setSelection(next);
      if (!next.has(target)) return null;
    } else if (!store.selection.has(target)) {
      store.setSelection([target]);
    } else if (store.selection.size > 1) {
      collapseTo = target;
    }
    return startMove(collapseTo);
  }

  // Dragging inside a multi-selection's box moves it, as in Figma.
  const sb = selectionBounds(store);
  if (sb && store.selection.size > 1 && containsPoint(sb, w) && !e.shiftKey) return startMove(null);

  const base = e.shiftKey ? new Set(store.selection) : new Set<string>();
  if (!e.shiftKey) store.setSelection([]);
  return { kind: "marquee", start: p, startWorld: w, active: false, base };
}

// ----- drag -----

export function moveGesture(ctx: GestureContext, g: Gesture, e: PointerEvent, p: Point): void {
  const { store } = ctx;
  const w = world(store, p);
  const noSnap = e.metaKey || e.ctrlKey;

  switch (g.kind) {
    case "move": {
      if (!g.moving && !pastThreshold(g.start, p)) return;
      g.moving = true;
      let dx = (p.x - g.start.x) / store.camera.z;
      let dy = (p.y - g.start.y) / store.camera.z;
      let guides: Guide[] = [];
      if (g.startBounds && !noSnap) {
        const moved = { ...g.startBounds, x: g.startBounds.x + dx, y: g.startBounds.y + dy };
        const s = snapRect(moved, snapTargets(store, g.exclude), threshold(store));
        dx += s.dx;
        dy += s.dy;
        guides = s.guides;
      }
      const layout = store.docState.layout;
      ctx.schedule(() => {
        setProps(store.doc, moveUpdates(g.startAll, g.ids, dx, dy, layout), store.origin);
        store.setInteraction({ guides });
      });
      return;
    }
    case "marquee": {
      if (!g.active && !pastThreshold(g.start, p)) return;
      g.active = true;
      const rect = normalizeRect(g.startWorld, w);
      store.setMarquee(rect);
      store.setSelection([...g.base, ...marqueeSelect(store.hitContext(), rect)]);
      return;
    }
    case "resize": {
      let dx = (p.x - g.start.x) / store.camera.z;
      let dy = (p.y - g.start.y) / store.camera.z;
      let guides: Guide[] = [];
      if (!noSnap) {
        const corner = {
          x: (g.handle === "nw" || g.handle === "sw" ? g.bounds.x : g.bounds.x + g.bounds.w) + dx,
          y: (g.handle === "nw" || g.handle === "ne" ? g.bounds.y : g.bounds.y + g.bounds.h) + dy,
        };
        const s = snapPoint(corner, snapTargets(store, g.exclude), threshold(store));
        dx += s.dx;
        dy += s.dy;
        guides = s.guides;
      }
      const only = g.ids.length === 1 ? g.startAll.get(g.ids[0]) : undefined;
      const min = only?.type === "block" ? BLOCK_MIN_SIZE : { w: 8, h: 8 };
      const next = resizeRect(g.bounds, g.handle, dx, dy, { keepAspect: e.shiftKey, min });
      const layout = store.docState.layout;
      ctx.schedule(() => {
        const updates = resizeUpdates(g.startAll, g.ids, layout, g.bounds, next);
        store.doc.transact(() => {
          setProps(store.doc, updates, store.origin);
          const texts = updates
            .filter((u) => g.startAll.get(u.id)?.type === "text")
            .map((u) => u.id);
          if (texts.length) fitTextElements(elementsOf(store.doc), texts);
        }, store.origin);
        store.setInteraction({ guides });
      });
      return;
    }
    case "endpoint": {
      g.moved = true;
      const el = store.docState.elements.get(g.id);
      if (!el) return;
      const { end, target } = endAt(store, w, withDescendants([g.id], store.docState.elements));
      const o = parentOrigin(el, store.docState.elements) ?? { x: 0, y: 0 };
      const stored: ConnectorEnd =
        end.kind === "point"
          ? { kind: "point", x: Math.round(end.x - o.x), y: Math.round(end.y - o.y) }
          : end;
      store.setInteraction({ bindHover: target });
      ctx.schedule(() =>
        setProps(store.doc, [{ id: g.id, props: { [g.side]: stored } }], store.origin),
      );
      return;
    }
    case "create": {
      if (!pastThreshold(g.start, p)) {
        g.rect = null;
        store.setInteraction({ preview: null, guides: [] });
        return;
      }
      let end = w;
      let guides: Guide[] = [];
      if (!noSnap) {
        const s = snapPoint(w, snapTargets(store, new Set()), threshold(store));
        end = { x: w.x + s.dx, y: w.y + s.dy };
        guides = s.guides;
      }
      g.rect = dragRect(g.startWorld, end, e.shiftKey);
      store.setInteraction({
        preview: { kind: "element", element: createPreview(store, g, g.rect) },
        guides,
      });
      return;
    }
    case "connector": {
      const to = e.shiftKey ? constrain(g.startWorld, w) : w;
      const exclude = new Set<string>();
      const { end, target } = endAt(store, to, exclude);
      g.end = end;
      const el = connectorPreview(store, g);
      store.setInteraction({
        bindHover: target,
        preview: el ? { kind: "element", element: el } : null,
      });
      return;
    }
    case "pen": {
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      const el = (e.currentTarget ?? e.target) as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      const add = (cx: number, cy: number, pressure: number) => {
        const wp = r ? world(store, { x: cx - r.left, y: cy - r.top }) : w;
        g.points.push({ x: wp.x, y: wp.y, pressure });
      };
      if (events.length > 1 && r) for (const c of events) add(c.clientX, c.clientY, c.pressure);
      else g.points.push({ x: w.x, y: w.y, pressure: e.pressure });
      store.setInteraction({
        preview: {
          kind: "pen",
          points: g.points.slice(),
          tool: g.tool,
          parentOrigin: g.parentOrigin,
        },
      });
      return;
    }
    case "erase": {
      for (const id of eraserHits(store.hitContext(), g.last, w, store.camera.z)) g.hits.add(id);
      g.last = w;
      g.trail = [...g.trail.slice(-TRAIL), w];
      store.setInteraction({
        erasing: new Set(g.hits),
        preview: { kind: "eraser", trail: g.trail },
      });
      return;
    }
    case "click":
      return;
  }
}

function createPreview(
  store: CanvasStore,
  g: Extract<Gesture, { kind: "create" }>,
  rect: Rect,
): ElementSnapshot {
  return snapshotOf("__preview", previewInput(store, g, rect));
}

// ----- release -----

export function endGesture(ctx: GestureContext, g: Gesture, e: PointerEvent, p: Point): void {
  const { store } = ctx;
  const w = world(store, p);
  ctx.flush();
  store.setInteraction({ guides: [], bindHover: null });

  const finishTool = () => {
    if (!STICKY_TOOLS.has(ctx.tool)) ctx.setTool("select");
  };

  switch (g.kind) {
    case "move": {
      if (!g.moving) {
        if (g.collapseTo && !e.shiftKey) store.setSelection([g.collapseTo]);
        return;
      }
      reparentAfterMove(store.doc, g.ids, store.docState.layout, w, store.origin);
      syncConnectorBoxes(store);
      store.undo.stopCapturing();
      return;
    }
    case "marquee":
      store.setMarquee(null);
      return;
    case "resize":
    case "endpoint":
      syncConnectorBoxes(store);
      store.undo.stopCapturing();
      return;
    case "create": {
      store.setInteraction({ preview: null });
      const rect =
        g.rect && (g.rect.w >= MIN_DRAG || g.rect.h >= MIN_DRAG)
          ? g.rect
          : clickRect(g.tool, g.startWorld);
      const all = readElements(store.doc);
      const id = createElement(
        store.doc,
        {
          ...previewInput(store, g, rect),
          parentId: g.parentId && all.has(g.parentId) ? g.parentId : null,
        },
        store.origin,
      );
      if (g.tool === "frame") adoptInto(store, id, rect);
      store.setSelection([id]);
      finishTool();
      if (g.tool === "sticky") store.setEditing({ id });
      return;
    }
    case "connector": {
      store.setInteraction({ preview: null });
      if (!g.end || !pastThreshold(g.start, p, DRAG_THRESHOLD * 2)) return;
      const id = createElement(
        store.doc,
        newConnector(g.tool, g.startEnd, g.end, store.toolStyle, {
          parentId: null,
          origin: { x: 0, y: 0 },
          createdBy: store.userId,
        }),
        store.origin,
      );
      syncConnectorBoxes(store);
      store.setSelection([id]);
      finishTool();
      return;
    }
    case "pen": {
      store.setInteraction({ preview: null });
      const s = strokeFromInput(g.points);
      if (!s) return;
      const all = readElements(store.doc);
      createElement(
        store.doc,
        newStroke(s.box, s.points, g.tool, store.toolStyle, {
          parentId: g.parentId && all.has(g.parentId) ? g.parentId : null,
          origin: g.parentOrigin,
          createdBy: store.userId,
        }),
        store.origin,
      );
      store.undo.stopCapturing();
      return;
    }
    case "erase": {
      store.setInteraction({ erasing: new Set(), preview: null });
      if (g.hits.size) {
        removeElements(store.doc, g.hits, store.origin, store.docState.layout.ends);
        store.setSelection([...store.selection].filter((id) => store.docState.elements.has(id)));
      }
      store.undo.stopCapturing();
      return;
    }
    case "click": {
      if (pastThreshold(g.start, p, DRAG_THRESHOLD * 2)) return;
      if (g.tool === "comment") {
        ctx.onComment(g.startWorld);
        return;
      }
      // Text: into an existing text or sticky, or a new one here.
      // Back to select first: changing tools ends any typing.
      finishTool();
      const leaf = hitLeaf(store.hitContext(), g.startWorld, store.camera.z);
      const hit = leaf ? store.docState.elements.get(leaf) : undefined;
      if (hit && (hit.type === "text" || hit.type === "sticky")) {
        store.setSelection([hit.id]);
        store.setEditing({ id: hit.id });
      } else {
        const all = store.docState.elements;
        const parentId = frameAt(store.docState.layout, all, g.startWorld, new Set());
        store.setSelection([]);
        store.setEditing({
          draft: { at: g.startWorld, parentId, parentOrigin: originOf(parentId, all) },
        });
      }
      return;
    }
  }
}

function previewInput(store: CanvasStore, g: Extract<Gesture, { kind: "create" }>, rect: Rect) {
  const at = { parentId: g.parentId, origin: g.parentOrigin, createdBy: store.userId };
  return g.tool === "frame"
    ? newFrame(rect, nextFrameName(store.docState.elements.values()), at)
    : g.tool === "sticky"
      ? newSticky(rect, store.toolStyle, at)
      : newShape(g.tool, rect, store.toolStyle, at);
}

// A new frame drawn around elements takes the ones entirely inside it that
// sit at the same level.
function adoptInto(store: CanvasStore, frameId: string, rect: Rect) {
  const { elements, layout } = store.docState;
  const frame = elements.get(frameId);
  if (!frame) return;
  const inside = [...elements.values()]
    .filter(
      (el) =>
        el.id !== frameId &&
        (el.parentId ?? null) === (frame.parentId ?? null) &&
        !el.locked &&
        !el.hidden,
    )
    .filter((el) => {
      const r = layout.geom.get(el.id)?.rect;
      return r && containsRect(rect, r);
    })
    .map((el) => el.id);
  if (inside.length) moveTo(store.doc, inside, frameId, store.origin);
}

// ----- double-click -----

export function doubleClick(ctx: GestureContext, w: Point): void {
  const { store } = ctx;
  const all = store.docState.elements;
  const leaf = hitLeaf(store.hitContext(), w, store.camera.z);
  if (!leaf) return;
  const el = all.get(leaf)!;
  const target = selectTarget(leaf, all, store.selection, { drill: true });
  if (target !== leaf && el) {
    // Into the group.
    store.setSelection([target]);
    return;
  }
  if (el.type === "block" && el.columnId != null) {
    ctx.onOpenBlock(el.columnId);
    return;
  }
  if ((el.type === "text" || el.type === "sticky") && store.canEdit) {
    store.setSelection([el.id]);
    store.setEditing({ id: el.id });
  }
}

// The cursor over the board for a tool, when nothing else claims it.
export function toolCursor(tool: Tool): string {
  switch (tool) {
    case "hand":
      return "grab";
    case "text":
      return "text";
    case "select":
      return "default";
    default:
      return "crosshair";
  }
}
