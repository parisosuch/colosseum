// Canvas comment threads on the client: where a new thread attaches, where a
// thread's pin is drawn, and the thread list as live events change it. Pure,
// so all of it is tested without a browser. The `?thread=` link is route.ts's.

import type * as Y from "yjs";

import {
  threadOffset,
  threadPosition,
  type CanvasThread,
  type ThreadChannelEvent,
  type ThreadComment,
} from "@/lib/realtime/canvas-threads";
import type { Point, Rect } from "./camera";
import { containsPoint } from "./geometry";
import { hitLeaf, type HitContext } from "./hit";

// --- anchoring ---

// What a comment dropped at `p` (world space) attaches to: the topmost element
// under it, locked ones included, since a locked element is still something
// to talk about. Empty space inside a frame attaches to the innermost frame,
// and empty space outside every frame to nothing, which makes a free pin.
export function threadTargetAt(ctx: HitContext, p: Point, zoom: number): string | null {
  const leaf = hitLeaf(ctx, p, zoom, { includeLocked: true });
  if (leaf) return leaf;
  for (let i = ctx.ordered.length - 1; i >= 0; i--) {
    const el = ctx.ordered[i];
    if (el.type !== "frame") continue;
    const g = ctx.geom.get(el.id);
    if (!g || (g.clip && !containsPoint(g.clip, p))) continue;
    if (containsPoint(g.rect, p)) return el.id;
  }
  return null;
}

// Where a new thread goes, in the shape startCanvasThreadAction takes: on an
// element, its id, the offset in its unrotated box and where that is now; on
// empty space, the point.
export type NewThreadAnchor =
  | { elementId: string; offsetX: number; offsetY: number; x: number; y: number }
  | { x: number; y: number };

export function threadAnchorAt(
  elements: Y.Map<Y.Map<unknown>>,
  ctx: HitContext,
  p: Point,
  zoom: number,
): NewThreadAnchor {
  const target = threadTargetAt(ctx, p, zoom);
  const offset = target ? threadOffset(elements, target, p) : null;
  if (!target || !offset) return { x: p.x, y: p.y };
  return { elementId: target, offsetX: offset.offset_x, offsetY: offset.offset_y, x: p.x, y: p.y };
}

// The anchor as it stands now: an element may have moved since the pin was
// dropped, and the thread is written with where the pin is drawn. An element
// that's gone leaves the point where it was dropped.
export function currentAnchor(
  elements: Y.Map<Y.Map<unknown>>,
  anchor: NewThreadAnchor,
): NewThreadAnchor {
  if (!("elementId" in anchor)) return anchor;
  const at = threadPosition(elements, anchor.elementId, {
    offset_x: anchor.offsetX,
    offset_y: anchor.offsetY,
  });
  if (!at) return { x: anchor.x, y: anchor.y };
  return { ...anchor, x: at.x, y: at.y };
}

// Where a thread's pin is drawn: on its element when it has one in the doc,
// else at its stored position. `last` is where it was last drawn, for the
// moment between an element's delete reaching this client and the server's
// `thread.detached`, when the stored position of a pinned thread may be old.
export function pinPosition(
  elements: Y.Map<Y.Map<unknown>>,
  thread: Pick<CanvasThread, "element_id" | "offset_x" | "offset_y" | "x" | "y">,
  last?: Point,
): Point {
  if (thread.element_id !== null) {
    const at = threadPosition(elements, thread.element_id, thread);
    if (at) return at;
    if (last) return last;
  }
  return { x: thread.x, y: thread.y };
}

// --- the thread list ---

export type ThreadsState = {
  // Every thread on the canvas, by id.
  threads: ReadonlyMap<number, CanvasThread>;
  // Comments of the threads that have been opened, oldest first.
  comments: ReadonlyMap<number, readonly ThreadComment[]>;
  // Comment ids already counted in a reply count, and ones already removed,
  // so a comment this client posted or deleted isn't counted twice when the
  // server's event for it arrives too.
  seen: ReadonlySet<number>;
  gone: ReadonlySet<number>;
};

export const EMPTY_THREADS: ThreadsState = {
  threads: new Map(),
  comments: new Map(),
  seen: new Set(),
  gone: new Set(),
};

// A fresh list from the server. Comments already loaded are kept for threads
// that are still there.
export function loadThreads(state: ThreadsState, list: readonly CanvasThread[]): ThreadsState {
  const threads = new Map(list.map((t) => [t.id, t]));
  const comments = new Map([...state.comments].filter(([id]) => threads.has(id)));
  return { ...state, threads, comments };
}

// One thread with all its comments, from getCanvasThreadAction.
export function loadThread(
  state: ThreadsState,
  thread: CanvasThread & { comments: readonly ThreadComment[] },
): ThreadsState {
  const { comments: list, ...rest } = thread;
  const threads = new Map(state.threads);
  threads.set(rest.id, rest);
  const comments = new Map(state.comments);
  comments.set(rest.id, list);
  const seen = new Set(state.seen);
  for (const c of list) seen.add(c.id);
  return { ...state, threads, comments, seen };
}

function withThread(
  state: ThreadsState,
  id: number,
  patch: (t: CanvasThread) => CanvasThread,
): ThreadsState {
  const t = state.threads.get(id);
  if (!t) return state;
  const threads = new Map(state.threads);
  threads.set(id, patch(t));
  return { ...state, threads };
}

// A live event, or this client's own write fed through the same path.
export function applyThreadEvent(state: ThreadsState, event: ThreadChannelEvent): ThreadsState {
  switch (event.type) {
    case "thread.created": {
      const { thread } = event;
      if (state.threads.has(thread.id)) return state;
      const threads = new Map(state.threads);
      threads.set(thread.id, thread);
      const seen = new Set(state.seen);
      if (thread.starter) seen.add(thread.starter.id);
      return { ...state, threads, seen };
    }
    case "thread.comment.added": {
      const c = event.comment;
      if (state.seen.has(c.id) || state.gone.has(c.id)) return state;
      if (!state.threads.has(c.thread_id)) return state;
      const seen = new Set(state.seen);
      seen.add(c.id);
      let comments = state.comments;
      const loaded = comments.get(c.thread_id);
      if (loaded) comments = new Map(comments).set(c.thread_id, [...loaded, c]);
      return withThread({ ...state, seen, comments }, c.thread_id, (t) => ({
        ...t,
        reply_count: t.reply_count + 1,
      }));
    }
    case "thread.comment.deleted": {
      if (state.gone.has(event.commentId)) return state;
      if (!state.threads.has(event.threadId)) return state;
      const gone = new Set(state.gone);
      gone.add(event.commentId);
      let comments = state.comments;
      const loaded = comments.get(event.threadId);
      if (loaded) {
        const kept = loaded.filter((c) => c.id !== event.commentId);
        comments = new Map(comments).set(event.threadId, kept);
      }
      return withThread({ ...state, gone, comments }, event.threadId, (t) => ({
        ...t,
        reply_count: Math.max(0, t.reply_count - 1),
      }));
    }
    case "thread.deleted": {
      if (!state.threads.has(event.threadId)) return state;
      const threads = new Map(state.threads);
      threads.delete(event.threadId);
      const comments = new Map(state.comments);
      comments.delete(event.threadId);
      return { ...state, threads, comments };
    }
    case "thread.detached":
      return withThread(state, event.threadId, (t) => ({
        ...t,
        last_element_id: t.element_id ?? t.last_element_id,
        element_id: null,
        x: event.x,
        y: event.y,
      }));
    case "thread.attached":
      return withThread(state, event.threadId, (t) => ({
        ...t,
        element_id: event.elementId,
        last_element_id: null,
      }));
  }
}

// Newest first, as the comments panel lists them.
export function threadsNewestFirst(state: ThreadsState): CanvasThread[] {
  return [...state.threads.values()].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id,
  );
}

// --- labels ---

// "On Easing Graphs" for a thread on an element, named the way the layers
// panel names it; a free pin is on the canvas itself.
export function threadPlace(
  thread: Pick<CanvasThread, "element_id">,
  nameOf: (elementId: string) => string | null,
): string {
  const name = thread.element_id ? nameOf(thread.element_id) : null;
  return name ? `On ${name}` : "Pinned to the canvas";
}

export function repliesLabel(count: number): string {
  if (count === 0) return "no replies";
  return count === 1 ? "1 reply" : `${count} replies`;
}

// "Just now", "12m ago", "2h ago", "Yesterday", "3 days ago", then the date.
export function timeAgo(date: Date, now: Date): string {
  const mins = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString();
}

// --- the popover ---

// A pin is this tall on screen, and its point is the bottom-left corner.
export const PIN_HEIGHT = 30;

// Where a thread's popover goes, in screen space: beside the pin `pin` (its
// point), to the right when it fits in `area` and to the left otherwise, top
// edge level with the pin's, and kept inside `area` either way.
export function popoverPlacement(
  pin: Point,
  size: { w: number; h: number },
  area: Rect,
  { gap = 8, pinWidth = 56 }: { gap?: number; pinWidth?: number } = {},
): { left: number; top: number } {
  const right = pin.x + pinWidth + gap;
  const leftSide = pin.x - gap - size.w;
  const maxLeft = area.x + area.w - size.w;
  let left: number;
  if (right <= maxLeft) left = right;
  else if (leftSide >= area.x) left = leftSide;
  else left = Math.max(area.x, Math.min(right, maxLeft));
  const maxTop = area.y + area.h - size.h;
  const top = Math.max(area.y, Math.min(pin.y - PIN_HEIGHT, maxTop));
  return { left, top };
}
