// Canvas comment threads, realtime side: the shapes the data layer, the server
// and clients share, the JSON events that carry them, and the anchoring that
// keeps a thread on its element, turns it into a free pin when the element is
// deleted, and pins it again if the element comes back.
//
// A thread on an element stores the element id and an offset from the
// element's world position. Clients render it at `threadPosition`, so it
// follows the element (and the frames and groups it sits in) through moves and
// resizes without the server doing anything. The server's job starts when the
// element goes: the thread row has to learn where the element last was,
// because nothing in the doc remembers a deleted element's position. A room
// keeps each pinned thread's world position in memory, updated on every
// transaction that touches the canvas, and writes it to the row the moment the
// element is deleted. The row keeps the element's id (`last_element_id`), so an
// undo or a restore that brings the element back pins the thread to it again.
//
// Like canvas-server.ts, this runs without Next or the data layer; storage comes
// in through ThreadAnchorStore (canvas-thread-store.ts in production).

import * as Y from "yjs";

import { elementsOf } from "./canvas-doc";
import type { RealtimeEvent } from "./events";

// One comment in a canvas thread, with its author's display info resolved.
export type ThreadComment = {
  id: number;
  created_at: string;
  thread_id: number;
  author_id: string;
  body: string;
  author_handle: string;
  author_avatar_url?: string;
};

export type CanvasThread = {
  id: number;
  channel_id: number;
  // The element it's pinned to, or null for a free pin.
  element_id: string | null;
  // For a free pin whose element was deleted: that element's id. If it comes
  // back, the thread is pinned to it again.
  last_element_id: string | null;
  // Offset from the element's world position. Null for a thread started on a
  // bare point; kept while a thread is a free pin, for when it's pinned again.
  offset_x: number | null;
  offset_y: number | null;
  // World position. Authoritative for a free pin; for a pinned thread, the
  // position last seen.
  x: number;
  y: number;
  created_by: string | null;
  created_at: string;
  // Comments after the first.
  reply_count: number;
  // The first comment, whose author's avatar the pin shows. Deleting it
  // deletes the thread.
  starter: ThreadComment | null;
};

// Data layer → realtime server, through events.ts.
export type ThreadRealtimeEvent =
  | { type: "thread.created"; channelId: number; thread: CanvasThread }
  | { type: "thread.comment.added"; channelId: number; comment: ThreadComment }
  | { type: "thread.comment.deleted"; channelId: number; threadId: number; commentId: number }
  // Its starter was deleted, which takes the thread and every reply with it.
  | { type: "thread.deleted"; channelId: number; threadId: number };

// Realtime server → every client on the canvas, read-only ones included, as
// protocol type 100. The first four mirror the data-layer events above. The
// server sends `thread.detached` when a thread's element is deleted and it
// becomes a free pin at (x, y), and `thread.attached` when that element comes
// back and the thread is pinned to it again, at its old offset.
export type ThreadChannelEvent =
  | { type: "thread.created"; thread: CanvasThread }
  | { type: "thread.comment.added"; comment: ThreadComment }
  | { type: "thread.comment.deleted"; threadId: number; commentId: number }
  | { type: "thread.deleted"; threadId: number }
  | { type: "thread.detached"; threadId: number; x: number; y: number }
  | { type: "thread.attached"; threadId: number; elementId: string };

export function isThreadEvent(event: RealtimeEvent): event is ThreadRealtimeEvent {
  return event.type.startsWith("thread.");
}

export function toThreadChannelEvent(event: ThreadRealtimeEvent): ThreadChannelEvent {
  const { channelId: _channelId, ...rest } = event;
  return rest;
}

// Deep enough for any real frame/group nesting; past it, a parent cycle.
const MAX_DEPTH = 64;

// An element's position in world space: its own x/y plus every ancestor's,
// since x/y are relative to the parent frame or group. Null when the element
// or an ancestor has no usable position, or the parent links loop. A parent
// that's missing from the doc ends the chain, as if the element were top-level.
export function elementWorldPosition(
  elements: Y.Map<Y.Map<unknown>>,
  elementId: string,
): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let id: unknown = elementId;
  for (let depth = 0; typeof id === "string"; depth++) {
    const el = elements.get(id);
    if (!el) {
      if (depth === 0) return null;
      break;
    }
    if (depth >= MAX_DEPTH) return null;
    const ex = el.get("x");
    const ey = el.get("y");
    if (typeof ex !== "number" || typeof ey !== "number") return null;
    if (!Number.isFinite(ex) || !Number.isFinite(ey)) return null;
    x += ex;
    y += ey;
    id = el.get("parentId");
  }
  return { x, y };
}

// Where a thread pinned to `elementId` sits in world space, or null when the
// element has no usable position. Clients and the server both go through this,
// so the free pin lands exactly where the pinned one was drawn.
export function threadPosition(
  elements: Y.Map<Y.Map<unknown>>,
  elementId: string,
  offset: { offset_x: number | null; offset_y: number | null },
): { x: number; y: number } | null {
  const at = elementWorldPosition(elements, elementId);
  if (!at) return null;
  return { x: at.x + (offset.offset_x ?? 0), y: at.y + (offset.offset_y ?? 0) };
}

// A thread the store says is pinned to an element, or is a free pin that was
// on one (`element_id` null, `last_element_id` set).
export type AnchoredThread = {
  id: number;
  element_id: string | null;
  last_element_id: string | null;
  offset_x: number | null;
  offset_y: number | null;
  x: number;
  y: number;
};

export interface ThreadAnchorStore {
  // A channel's threads that are pinned to an element or were.
  anchoredThreads(channelId: number): Promise<AnchoredThread[]>;
  // Make the thread a free pin at (x, y) that remembers `elementId`, if it's
  // still pinned to it. False when it wasn't (already freed, or deleted).
  detach(threadId: number, elementId: string, x: number, y: number): Promise<boolean>;
  // Pin a free thread to `elementId` again, if that's the element it was freed
  // from. False when it wasn't.
  reattach(threadId: number, elementId: string): Promise<boolean>;
  // Record the latest seen positions of pinned threads, skipping any that have
  // since been freed.
  savePositions(rows: { id: number; element_id: string; x: number; y: number }[]): Promise<void>;
}

// Free every thread in `channelId` pinned to an element that isn't in `doc`,
// at the element's position in `previous` when given, else at the position
// last stored. Returns the threads freed and where, so the caller can tell
// clients (`thread.detached`).
//
// An open canvas does this by itself whenever an element is deleted, a restore
// applied to the live doc included, and pins threads again when their element
// comes back; a canvas that loads does both for whatever changed while it was
// closed. Call this when elements disappear some other way and the threads
// should move now: a version restore written to a canvas nobody has open. It's
// idempotent, and a thread an open room already freed is skipped.
export async function freeOrphanedThreads(options: {
  store: ThreadAnchorStore;
  channelId: number;
  doc: Y.Doc;
  previous?: Y.Doc;
}): Promise<{ threadId: number; x: number; y: number }[]> {
  const { store, channelId, doc, previous } = options;
  const elements = elementsOf(doc);
  const before = previous ? elementsOf(previous) : null;
  const freed: { threadId: number; x: number; y: number }[] = [];
  for (const t of await store.anchoredThreads(channelId)) {
    if (t.element_id === null || elements.has(t.element_id)) continue;
    const at = (before && threadPosition(before, t.element_id, t)) ?? { x: t.x, y: t.y };
    if (await store.detach(t.id, t.element_id, at.x, at.y)) {
      freed.push({ threadId: t.id, ...at });
    }
  }
  return freed;
}

type Tracked = {
  elementId: string;
  // Pinned to the element, or a free pin waiting for it to come back.
  pinned: boolean;
  offset_x: number | null;
  offset_y: number | null;
  // Latest position seen in the doc (pinned) or the free pin's (free), and the
  // one the row holds.
  x: number;
  y: number;
  savedX: number;
  savedY: number;
};

// One open room's anchoring. Built by attachThreadAnchors.
export type ThreadAnchors = {
  // A thread event for this room's channel. A new thread starts being tracked;
  // a deleted one stops.
  handle(event: ThreadRealtimeEvent): void;
  // Settles once every write started so far has finished. For tests.
  idle(): Promise<void>;
  // Stop observing and save the latest positions. Call before the doc is
  // destroyed.
  detach(): Promise<void>;
};

// Start anchoring for a room whose doc has just loaded. Call it before the
// load-time prune, so a block element pruned on load frees its threads at its
// saved position. Pinned threads whose element is already missing are freed at
// their stored position, and free ones whose element is back are pinned again.
export async function attachThreadAnchors(options: {
  channelId: number;
  doc: Y.Doc;
  store: ThreadAnchorStore;
  send: (event: ThreadChannelEvent) => void;
}): Promise<ThreadAnchors> {
  const { channelId, doc, store, send } = options;
  const elements = elementsOf(doc);
  const threads = new Map<number, Tracked>();
  const byElement = new Map<string, Set<number>>();
  let writes: Promise<void> = Promise.resolve();
  let detached = false;

  function track(id: number, t: Tracked): void {
    threads.set(id, t);
    let set = byElement.get(t.elementId);
    if (!set) byElement.set(t.elementId, (set = new Set()));
    set.add(id);
  }

  function untrack(id: number): void {
    const t = threads.get(id);
    if (!t) return;
    threads.delete(id);
    const set = byElement.get(t.elementId);
    set?.delete(id);
    if (set?.size === 0) byElement.delete(t.elementId);
  }

  // Writes run one after another so a free, a re-pin and a position save for
  // the same row land in the order they happened.
  function enqueue(write: () => Promise<void>): void {
    writes = writes.then(write).catch((err) => {
      console.error(`[realtime] thread anchoring on canvas ${channelId} failed`, err);
    });
  }

  function free(id: number, t: Tracked): void {
    t.pinned = false;
    const { elementId, x, y } = t;
    enqueue(async () => {
      if (await store.detach(id, elementId, x, y)) {
        t.savedX = x;
        t.savedY = y;
        if (!detached) send({ type: "thread.detached", threadId: id, x, y });
      }
    });
  }

  function pin(id: number, t: Tracked): void {
    t.pinned = true;
    const { elementId } = t;
    enqueue(async () => {
      if (await store.reattach(id, elementId)) {
        if (!detached) send({ type: "thread.attached", threadId: id, elementId });
      }
    });
  }

  // Bring every tracked thread in line with the doc: free the pinned ones whose
  // element is gone (at the position cached before it went), pin the free ones
  // whose element is back, and refresh the pinned ones' positions, which can
  // move when the element or any frame or group above it does.
  function reconcile(): void {
    for (const [id, t] of threads) {
      const present = elements.has(t.elementId);
      if (t.pinned && !present) free(id, t);
      else if (!t.pinned && present) pin(id, t);
      if (t.pinned) {
        const at = threadPosition(elements, t.elementId, t);
        if (at) {
          t.x = at.x;
          t.y = at.y;
        }
      }
    }
  }

  for (const row of await store.anchoredThreads(channelId)) {
    const elementId = row.element_id ?? row.last_element_id;
    if (elementId === null) continue;
    track(row.id, {
      elementId,
      pinned: row.element_id !== null,
      offset_x: row.offset_x,
      offset_y: row.offset_y,
      x: row.x,
      y: row.y,
      savedX: row.x,
      savedY: row.y,
    });
  }
  reconcile();

  // Any change under `elements` can move a pinned thread, through its element
  // or an ancestor, or delete or restore an element.
  const observer = () => {
    if (threads.size > 0) reconcile();
  };
  elements.observeDeep(observer);

  return {
    handle(event) {
      if (event.type === "thread.deleted") {
        untrack(event.threadId);
        return;
      }
      if (event.type !== "thread.created") return;
      const { thread } = event;
      if (thread.element_id === null || threads.has(thread.id)) return;
      track(thread.id, {
        elementId: thread.element_id,
        pinned: true,
        offset_x: thread.offset_x,
        offset_y: thread.offset_y,
        x: thread.x,
        y: thread.y,
        savedX: thread.x,
        savedY: thread.y,
      });
      // An element deleted between the client pinning the thread and the
      // thread being saved frees it at the position the client sent.
      reconcile();
    },

    idle() {
      return writes;
    },

    detach() {
      if (!detached) {
        detached = true;
        elements.unobserveDeep(observer);
        const moved = [...threads]
          .filter(([, t]) => t.pinned && (t.x !== t.savedX || t.y !== t.savedY))
          .map(([id, t]) => ({ id, element_id: t.elementId, x: t.x, y: t.y }));
        if (moved.length > 0) enqueue(() => store.savePositions(moved));
      }
      return writes;
    },
  };
}
