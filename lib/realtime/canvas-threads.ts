// Canvas comment threads, realtime side: the shapes the data layer, the server
// and clients share, the JSON events that carry them, and the anchoring that
// keeps a thread on its element and turns it into a free pin when the element
// is deleted.
//
// A thread on an element stores the element id and an offset from the
// element's (x, y). Clients render it at `threadPosition`, so it follows the
// element through moves and resizes without the server doing anything. The
// server's job starts when the element goes: the thread row has to learn where
// the element last was, because nothing in the doc remembers a deleted
// element's position. A room keeps each anchored thread's world position in
// memory, updated on every transaction that touches its element, and writes it
// to the row the moment the element is deleted.
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
  // Offset from the element's (x, y). Null for a free pin made as one; a thread
  // freed by its element's deletion keeps its offset for the record.
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
  // The first comment still standing: whose avatar the pin shows. Null only in
  // the moment between a thread's last comment going and the thread with it.
  starter: ThreadComment | null;
};

// Data layer → realtime server, through events.ts.
export type ThreadRealtimeEvent =
  | { type: "thread.created"; channelId: number; thread: CanvasThread }
  | { type: "thread.comment.added"; channelId: number; comment: ThreadComment }
  | { type: "thread.comment.deleted"; channelId: number; threadId: number; commentId: number }
  // Its last comment was deleted, which takes the thread with it.
  | { type: "thread.deleted"; channelId: number; threadId: number };

// Realtime server → every client on the canvas, read-only ones included, as
// protocol type 100. The first four mirror the data-layer events above;
// `thread.detached` comes from the server when a thread's element is deleted
// and it becomes a free pin at (x, y).
export type ThreadChannelEvent =
  | { type: "thread.created"; thread: CanvasThread }
  | { type: "thread.comment.added"; comment: ThreadComment }
  | { type: "thread.comment.deleted"; threadId: number; commentId: number }
  | { type: "thread.deleted"; threadId: number }
  | { type: "thread.detached"; threadId: number; x: number; y: number };

export function isThreadEvent(event: RealtimeEvent): event is ThreadRealtimeEvent {
  return event.type.startsWith("thread.");
}

export function toThreadChannelEvent(event: ThreadRealtimeEvent): ThreadChannelEvent {
  const { channelId: _channelId, ...rest } = event;
  return rest;
}

// Where a thread pinned to `element` sits in world space, or null when the
// element has no usable position. Clients and the server both go through this,
// so the free pin lands exactly where the pinned one was drawn.
export function threadPosition(
  element: Y.Map<unknown>,
  offset: { offset_x: number | null; offset_y: number | null },
): { x: number; y: number } | null {
  const x = element.get("x");
  const y = element.get("y");
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: x + (offset.offset_x ?? 0), y: y + (offset.offset_y ?? 0) };
}

// A thread the store says is pinned to an element.
export type AnchoredThread = {
  id: number;
  element_id: string;
  offset_x: number | null;
  offset_y: number | null;
  x: number;
  y: number;
};

export interface ThreadAnchorStore {
  // A channel's threads that are pinned to an element.
  anchoredThreads(channelId: number): Promise<AnchoredThread[]>;
  // Make the thread a free pin at (x, y), if it's still pinned to `elementId`.
  // False when it wasn't (already freed, or deleted).
  detach(threadId: number, elementId: string, x: number, y: number): Promise<boolean>;
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
// applied to the live doc included. Call this when elements disappear some
// other way: a version restore written to a canvas nobody has open, or a doc
// swapped wholesale. It's idempotent, and a thread an open room already freed
// is skipped.
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
    if (elements.has(t.element_id)) continue;
    const old = before?.get(t.element_id);
    const at = (old && threadPosition(old, t)) ?? { x: t.x, y: t.y };
    if (await store.detach(t.id, t.element_id, at.x, at.y)) {
      freed.push({ threadId: t.id, ...at });
    }
  }
  return freed;
}

type Tracked = {
  elementId: string;
  offset_x: number | null;
  offset_y: number | null;
  // Latest position seen in the doc, and the one the row holds.
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
// saved position. Threads pinned to elements already missing are freed at their
// stored position.
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

  function untrack(id: number): Tracked | undefined {
    const t = threads.get(id);
    if (!t) return undefined;
    threads.delete(id);
    const set = byElement.get(t.elementId);
    set?.delete(id);
    if (set?.size === 0) byElement.delete(t.elementId);
    return t;
  }

  // Writes run one after another so a free and a position save for the same
  // row can't land out of order.
  function enqueue(write: () => Promise<void>): void {
    writes = writes.then(write).catch((err) => {
      console.error(`[realtime] thread anchoring on canvas ${channelId} failed`, err);
    });
  }

  function free(id: number, elementId: string, x: number, y: number): void {
    enqueue(async () => {
      if (await store.detach(id, elementId, x, y)) {
        if (!detached) send({ type: "thread.detached", threadId: id, x, y });
      }
    });
  }

  function refresh(elementId: string): void {
    const ids = byElement.get(elementId);
    if (!ids) return;
    const el = elements.get(elementId);
    if (!el) {
      // Gone: free every thread on it where the element last was.
      for (const id of [...ids]) {
        const t = untrack(id)!;
        free(id, elementId, t.x, t.y);
      }
      return;
    }
    for (const id of ids) {
      const t = threads.get(id)!;
      const at = threadPosition(el, t);
      if (at) {
        t.x = at.x;
        t.y = at.y;
      }
    }
  }

  for (const row of await store.anchoredThreads(channelId)) {
    const el = elements.get(row.element_id);
    if (!el) {
      free(row.id, row.element_id, row.x, row.y);
      continue;
    }
    const at = threadPosition(el, row) ?? { x: row.x, y: row.y };
    track(row.id, {
      elementId: row.element_id,
      offset_x: row.offset_x,
      offset_y: row.offset_y,
      x: at.x,
      y: at.y,
      savedX: row.x,
      savedY: row.y,
    });
  }

  // Every change under `elements`: a key added, replaced or deleted on the map
  // itself, or a field changed inside one element (path[0] is its id).
  const observer = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    if (threads.size === 0) return;
    const touched = new Set<string>();
    for (const event of events) {
      if (event.target === elements) {
        for (const key of event.changes.keys.keys()) touched.add(key);
      } else if (typeof event.path[0] === "string") {
        touched.add(event.path[0]);
      }
    }
    for (const id of touched) refresh(id);
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
      const el = elements.get(thread.element_id);
      if (!el) {
        // Deleted between the client pinning it and the thread being saved.
        free(thread.id, thread.element_id, thread.x, thread.y);
        return;
      }
      const at = threadPosition(el, thread) ?? { x: thread.x, y: thread.y };
      track(thread.id, {
        elementId: thread.element_id,
        offset_x: thread.offset_x,
        offset_y: thread.offset_y,
        x: at.x,
        y: at.y,
        savedX: thread.x,
        savedY: thread.y,
      });
    },

    idle() {
      return writes;
    },

    detach() {
      if (!detached) {
        detached = true;
        elements.unobserveDeep(observer);
        const moved = [...threads]
          .filter(([, t]) => t.x !== t.savedX || t.y !== t.savedY)
          .map(([id, t]) => ({ id, element_id: t.elementId, x: t.x, y: t.y }));
        if (moved.length > 0) enqueue(() => store.savePositions(moved));
      }
      return writes;
    },
  };
}
