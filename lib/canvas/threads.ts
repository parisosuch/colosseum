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
  // Threads this client has seen deleted. Ids aren't reused, so a response
  // that was already on its way when the delete landed can't bring one back.
  deleted: ReadonlySet<number>;
};

export const EMPTY_THREADS: ThreadsState = {
  threads: new Map(),
  comments: new Map(),
  seen: new Set(),
  gone: new Set(),
  deleted: new Set(),
};

// A fresh list from the server, after (re)connecting, and the live events that
// arrived while it was on its way, in order. The list replaces the threads; the
// events are applied on top, since the list may have been read before them.
// Loaded comments are dropped: after a reconnect they may be missing whatever
// was said while the socket was down, so the open thread is fetched again.
//
// A reply count can't be settled that way: an event for a comment says
// nothing about whether the list already counted it. Those threads are
// fetched whole (countsInDoubt).
export function loadThreads(
  state: ThreadsState,
  list: readonly CanvasThread[],
  during: readonly ThreadChannelEvent[] = [],
): ThreadsState {
  const threads = new Map(list.filter((t) => !state.deleted.has(t.id)).map((t) => [t.id, t]));
  let next: ThreadsState = { ...state, threads, comments: new Map() };
  for (const event of during) {
    if (event.type !== "thread.comment.added" && event.type !== "thread.comment.deleted") {
      next = applyThreadEvent(next, event);
    }
  }
  return next;
}

// The threads whose reply counts a reload with these events in its window
// can't vouch for.
export function countsInDoubt(during: readonly ThreadChannelEvent[]): number[] {
  const ids = new Set<number>();
  for (const event of during) {
    if (event.type === "thread.comment.added") ids.add(event.comment.thread_id);
    else if (event.type === "thread.comment.deleted") ids.add(event.threadId);
  }
  return [...ids];
}

// One thread with all its comments, from getCanvasThreadAction, and the live
// events that arrived while it was on its way. Those events were applied as
// they came, to the state this response replaces, so they're replayed against
// the response itself: a comment it already has isn't added again, and one it
// no longer has isn't taken off the count again.
export function loadThread(
  state: ThreadsState,
  thread: CanvasThread & { comments: readonly ThreadComment[] },
  during: readonly ThreadChannelEvent[] = [],
): ThreadsState {
  if (state.deleted.has(thread.id)) return state;
  const { comments: loaded, ...rest } = thread;
  let replies = rest.reply_count;
  const list = [...loaded];
  const seen = new Set(state.seen);
  const gone = new Set(state.gone);
  let next: ThreadsState = state;
  for (const event of during) {
    if (event.type === "thread.comment.added") {
      const c = event.comment;
      if (c.thread_id !== rest.id || list.some((x) => x.id === c.id) || gone.has(c.id)) continue;
      list.push(c);
      replies++;
    } else if (event.type === "thread.comment.deleted") {
      if (event.threadId !== rest.id) continue;
      gone.add(event.commentId);
      const i = list.findIndex((x) => x.id === event.commentId);
      if (i < 0) continue;
      list.splice(i, 1);
      replies = Math.max(0, replies - 1);
    } else if (event.type === "thread.deleted" && event.threadId === rest.id) {
      return applyThreadEvent(state, event);
    }
  }
  for (const c of list) seen.add(c.id);
  const threads = new Map(next.threads);
  threads.set(rest.id, { ...rest, reply_count: replies });
  const comments = new Map(next.comments);
  comments.set(rest.id, list);
  next = { ...next, threads, comments, seen, gone };
  // Pinning changes in the window, on the thread as it now stands.
  for (const event of during) {
    if (
      (event.type === "thread.detached" || event.type === "thread.attached") &&
      event.threadId === rest.id
    ) {
      next = applyThreadEvent(next, event);
    }
  }
  return next;
}

// A delete this client made that the server refused: the comment is back
// (the caller fetches the thread again), and a later delete of it, this
// client's or anyone's, has to count.
export function forgetGone(state: ThreadsState, commentId: number): ThreadsState {
  if (!state.gone.has(commentId)) return state;
  const gone = new Set(state.gone);
  gone.delete(commentId);
  return { ...state, gone };
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

const THREAD_EVENTS: ReadonlySet<string> = new Set<ThreadChannelEvent["type"]>([
  "thread.created",
  "thread.comment.added",
  "thread.comment.deleted",
  "thread.deleted",
  "thread.detached",
  "thread.attached",
]);

// Whether a channel event is one of the thread events this client knows. The
// server adds event types over time, and an older tab must ignore them.
export function isKnownThreadEvent(event: { type: string }): event is ThreadChannelEvent {
  return THREAD_EVENTS.has(event.type);
}

// A live event, or this client's own write fed through the same path.
export function applyThreadEvent(state: ThreadsState, event: ThreadChannelEvent): ThreadsState {
  switch (event.type) {
    case "thread.created": {
      const { thread } = event;
      if (state.threads.has(thread.id) || state.deleted.has(thread.id)) return state;
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
        // Not in the loaded comments: they were read after it went, and the
        // count that came with them doesn't include it.
        if (kept.length === loaded.length) return { ...state, gone };
        comments = new Map(comments).set(event.threadId, kept);
      }
      return withThread({ ...state, gone, comments }, event.threadId, (t) => ({
        ...t,
        reply_count: Math.max(0, t.reply_count - 1),
      }));
    }
    case "thread.deleted": {
      const deleted = new Set(state.deleted).add(event.threadId);
      if (!state.threads.has(event.threadId)) return { ...state, deleted };
      const threads = new Map(state.threads);
      threads.delete(event.threadId);
      const comments = new Map(state.comments);
      comments.delete(event.threadId);
      return { ...state, threads, comments, deleted };
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
    default:
      return state;
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
