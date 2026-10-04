import { describe, expect, test } from "bun:test";

import { elementsOf } from "@/lib/realtime/canvas-doc";
import type { CanvasThread, ThreadComment } from "@/lib/realtime/canvas-threads";
import { paintOrder } from "./elements";
import type { HitContext } from "./hit";
import { docWith, state as stateOf } from "./test-doc";
import {
  applyThreadEvent,
  currentAnchor,
  EMPTY_THREADS,
  loadThread,
  loadThreads,
  pinPosition,
  popoverPlacement,
  repliesLabel,
  threadAnchorAt,
  threadPlace,
  threadsNewestFirst,
  threadTargetAt,
  timeAgo,
} from "./threads";

function ctx(doc: ReturnType<typeof docWith>): HitContext {
  const { all, layout } = stateOf(doc);
  return { all, ordered: paintOrder(all), geom: layout.geom };
}

const scene = () =>
  docWith({
    card: { type: "block", x: 0, y: 0, w: 200, h: 100, columnId: 7 },
    hollow: { type: "rect", x: 400, y: 0, w: 100, h: 100, fill: "none", width: 2 },
    outer: { type: "frame", x: 1000, y: 0, w: 600, h: 600, name: "Outer", fill: "card" },
    inner: { type: "frame", x: 100, y: 100, w: 300, h: 300, parentId: "outer", fill: "card" },
    nested: { type: "sticky", x: 50, y: 50, w: 100, h: 100, parentId: "inner", fill: "yellow" },
    locked: { type: "rect", x: 0, y: 400, w: 50, h: 50, fill: "yellow", locked: true },
  });

describe("threadTargetAt", () => {
  test("picks the element under the point, locked ones included", () => {
    const c = ctx(scene());
    expect(threadTargetAt(c, { x: 10, y: 10 }, 1)).toBe("card");
    expect(threadTargetAt(c, { x: 10, y: 410 }, 1)).toBe("locked");
  });

  test("a hollow shape is hit by its outline; its middle is empty space", () => {
    const c = ctx(scene());
    expect(threadTargetAt(c, { x: 400, y: 50 }, 1)).toBe("hollow");
    expect(threadTargetAt(c, { x: 450, y: 50 }, 1)).toBeNull();
  });

  test("an element inside nested frames is hit at its world position", () => {
    const c = ctx(scene());
    // outer (1000, 0) + inner (100, 100) + nested (50, 50).
    expect(threadTargetAt(c, { x: 1160, y: 160 }, 1)).toBe("nested");
  });

  test("empty space in a frame attaches to the innermost frame", () => {
    const c = ctx(scene());
    expect(threadTargetAt(c, { x: 1350, y: 350 }, 1)).toBe("inner");
    expect(threadTargetAt(c, { x: 1550, y: 550 }, 1)).toBe("outer");
    expect(threadTargetAt(c, { x: 800, y: 800 }, 1)).toBeNull();
  });
});

describe("threadAnchorAt", () => {
  test("on an element: its id and the offset from its world position", () => {
    const doc = scene();
    expect(threadAnchorAt(elementsOf(doc), ctx(doc), { x: 1160, y: 170 }, 1)).toEqual({
      elementId: "nested",
      offsetX: 10,
      offsetY: 20,
      x: 1160,
      y: 170,
    });
  });

  test("on empty space: just the point", () => {
    const doc = scene();
    expect(threadAnchorAt(elementsOf(doc), ctx(doc), { x: 800, y: 800 }, 1)).toEqual({
      x: 800,
      y: 800,
    });
  });

  test("on a rotated element: the offset is in its unrotated box", () => {
    const doc = scene();
    const els = elementsOf(doc);
    els.get("card")!.set("rotation", 180);
    // Hit-testing uses the unrotated box (nothing draws rotation yet). Half a
    // turn about (100, 50) puts the box's bottom-right corner at (0, 0).
    const anchor = threadAnchorAt(els, ctx(doc), { x: 0, y: 0 }, 1);
    expect(anchor).toMatchObject({ elementId: "card", x: 0, y: 0 });
    if (!("elementId" in anchor)) throw new Error("not on the card");
    expect(anchor.offsetX).toBeCloseTo(200, 9);
    expect(anchor.offsetY).toBeCloseTo(100, 9);
  });

  test("currentAnchor follows the element, or keeps the point once it's gone", () => {
    const doc = scene();
    const els = elementsOf(doc);
    const anchor = threadAnchorAt(els, ctx(doc), { x: 10, y: 10 }, 1);
    els.get("card")!.set("x", 500);
    expect(currentAnchor(els, anchor)).toEqual({
      elementId: "card",
      offsetX: 10,
      offsetY: 10,
      x: 510,
      y: 10,
    });
    els.delete("card");
    expect(currentAnchor(els, anchor)).toEqual({ x: 10, y: 10 });
    expect(currentAnchor(els, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });
});

describe("pinPosition", () => {
  const pinned = { element_id: "nested", offset_x: 5, offset_y: 5, x: -1, y: -1 };

  test("a pinned thread sits on its element, through nested frames", () => {
    const doc = scene();
    const els = elementsOf(doc);
    expect(pinPosition(els, pinned)).toEqual({ x: 1155, y: 155 });
    // The outer frame moves; its grandchild's pin goes with it.
    els.get("outer")!.set("x", 0);
    expect(pinPosition(els, pinned)).toEqual({ x: 155, y: 155 });
  });

  test("a pinned thread turns with its element", () => {
    const doc = scene();
    const els = elementsOf(doc);
    els.get("nested")!.set("rotation", 90);
    // nested's box is (1150, 150)–(1250, 250), centre (1200, 200); the offset
    // (-45, -45) from the centre turns to (45, -45).
    const at = pinPosition(els, pinned);
    expect(at.x).toBeCloseTo(1245, 9);
    expect(at.y).toBeCloseTo(155, 9);
  });

  test("a free pin stays at its own position", () => {
    const els = elementsOf(scene());
    expect(pinPosition(els, { ...pinned, element_id: null, x: 40, y: 50 })).toEqual({
      x: 40,
      y: 50,
    });
  });

  test("an element gone before the server frees its thread keeps the pin where it was drawn", () => {
    const doc = scene();
    const els = elementsOf(doc);
    const last = pinPosition(els, pinned);
    els.delete("nested");
    expect(pinPosition(els, pinned, last)).toEqual({ x: 1155, y: 155 });
    expect(pinPosition(els, pinned)).toEqual({ x: -1, y: -1 });
  });
});

function comment(id: number, thread_id: number, body = "hi"): ThreadComment {
  return {
    id,
    thread_id,
    body,
    created_at: new Date(Date.UTC(2026, 9, 1, 12, 0, id)).toISOString(),
    author_id: "u",
    author_handle: "alice",
  };
}

function thread(id: number, patch: Partial<CanvasThread> = {}): CanvasThread {
  return {
    id,
    channel_id: 1,
    element_id: null,
    last_element_id: null,
    offset_x: null,
    offset_y: null,
    x: 0,
    y: 0,
    created_by: "u",
    created_at: new Date(Date.UTC(2026, 9, 1, id)).toISOString(),
    reply_count: 0,
    starter: comment(id * 100, id),
    ...patch,
  };
}

describe("applyThreadEvent", () => {
  test("a new thread joins the list once", () => {
    let s = applyThreadEvent(EMPTY_THREADS, { type: "thread.created", thread: thread(1) });
    s = applyThreadEvent(s, { type: "thread.created", thread: thread(1, { x: 9 }) });
    expect([...s.threads.values()]).toEqual([thread(1)]);
  });

  test("a reply counts once, whether it comes back from the action or the socket first", () => {
    let s = loadThread(EMPTY_THREADS, { ...thread(1), comments: [comment(100, 1)] });
    const reply = comment(101, 1);
    s = applyThreadEvent(s, { type: "thread.comment.added", comment: reply });
    s = applyThreadEvent(s, { type: "thread.comment.added", comment: reply });
    expect(s.threads.get(1)!.reply_count).toBe(1);
    expect(s.comments.get(1)!.map((c) => c.id)).toEqual([100, 101]);
  });

  test("a reply to a thread whose comments aren't loaded only bumps the count", () => {
    let s = loadThreads(EMPTY_THREADS, [thread(1, { reply_count: 2 })]);
    s = applyThreadEvent(s, { type: "thread.comment.added", comment: comment(5, 1) });
    expect(s.threads.get(1)!.reply_count).toBe(3);
    expect(s.comments.has(1)).toBe(false);
  });

  test("a deleted reply goes once and lowers the count", () => {
    let s = loadThread(EMPTY_THREADS, {
      ...thread(1, { reply_count: 1 }),
      comments: [comment(100, 1), comment(101, 1)],
    });
    const del = { type: "thread.comment.deleted", threadId: 1, commentId: 101 } as const;
    s = applyThreadEvent(applyThreadEvent(s, del), del);
    expect(s.threads.get(1)!.reply_count).toBe(0);
    expect(s.comments.get(1)!.map((c) => c.id)).toEqual([100]);
    // Its late `added` doesn't bring it back.
    s = applyThreadEvent(s, { type: "thread.comment.added", comment: comment(101, 1) });
    expect(s.comments.get(1)!.map((c) => c.id)).toEqual([100]);
  });

  test("a deleted thread leaves the list with its comments", () => {
    let s = loadThread(EMPTY_THREADS, { ...thread(1), comments: [comment(100, 1)] });
    s = applyThreadEvent(s, { type: "thread.deleted", threadId: 1 });
    expect(s.threads.size).toBe(0);
    expect(s.comments.size).toBe(0);
  });

  test("detach frees the pin where the server says; attach pins it again", () => {
    let s = loadThreads(EMPTY_THREADS, [
      thread(1, { element_id: "card", offset_x: 3, offset_y: 4 }),
    ]);
    s = applyThreadEvent(s, { type: "thread.detached", threadId: 1, x: 70, y: 80 });
    expect(s.threads.get(1)).toMatchObject({
      element_id: null,
      last_element_id: "card",
      x: 70,
      y: 80,
      offset_x: 3,
    });
    s = applyThreadEvent(s, { type: "thread.attached", threadId: 1, elementId: "card" });
    expect(s.threads.get(1)).toMatchObject({ element_id: "card", last_element_id: null });
  });

  test("events for a thread this client doesn't have change nothing", () => {
    for (const event of [
      { type: "thread.comment.added", comment: comment(1, 9) },
      { type: "thread.comment.deleted", threadId: 9, commentId: 1 },
      { type: "thread.deleted", threadId: 9 },
      { type: "thread.detached", threadId: 9, x: 0, y: 0 },
      { type: "thread.attached", threadId: 9, elementId: "x" },
    ] as const) {
      expect(applyThreadEvent(EMPTY_THREADS, event)).toBe(EMPTY_THREADS);
    }
  });

  test("a reload keeps loaded comments only for threads still there", () => {
    let s = loadThread(EMPTY_THREADS, { ...thread(1), comments: [comment(100, 1)] });
    s = loadThread(s, { ...thread(2), comments: [comment(200, 2)] });
    s = loadThreads(s, [thread(2), thread(3)]);
    expect([...s.comments.keys()]).toEqual([2]);
    expect(threadsNewestFirst(s).map((t) => t.id)).toEqual([3, 2]);
  });
});

describe("labels", () => {
  test("threadPlace names the element, or says it's on the canvas", () => {
    const names: Record<string, string> = { card: "Easing Graphs" };
    const nameOf = (id: string) => names[id] ?? null;
    expect(threadPlace({ element_id: "card" }, nameOf)).toBe("On Easing Graphs");
    expect(threadPlace({ element_id: null }, nameOf)).toBe("Pinned to the canvas");
    expect(threadPlace({ element_id: "gone" }, nameOf)).toBe("Pinned to the canvas");
  });

  test("repliesLabel", () => {
    expect([0, 1, 2].map(repliesLabel)).toEqual(["no replies", "1 reply", "2 replies"]);
  });

  test("timeAgo", () => {
    const now = new Date(2026, 9, 4, 15, 0);
    expect(timeAgo(new Date(2026, 9, 4, 14, 59, 30), now)).toBe("Just now");
    expect(timeAgo(new Date(2026, 9, 4, 14, 48), now)).toBe("12m ago");
    expect(timeAgo(new Date(2026, 9, 4, 13, 0), now)).toBe("2h ago");
    expect(timeAgo(new Date(2026, 9, 3, 9, 0), now)).toBe("Yesterday");
    expect(timeAgo(new Date(2026, 9, 2, 16, 0), now)).toBe("2 days ago");
  });
});

describe("popoverPlacement", () => {
  const area = { x: 0, y: 66, w: 1000, h: 770 };
  const size = { w: 350, h: 400 };

  test("opens to the right of the pin, level with its top", () => {
    expect(popoverPlacement({ x: 100, y: 300 }, size, area)).toEqual({ left: 164, top: 270 });
  });

  test("opens to the left when the right side has no room", () => {
    expect(popoverPlacement({ x: 800, y: 300 }, size, area)).toEqual({ left: 442, top: 270 });
  });

  test("stays inside the open area when neither side fits or the pin is near an edge", () => {
    const narrow = { x: 0, y: 0, w: 500, h: 800 };
    expect(popoverPlacement({ x: 200, y: 300 }, size, narrow)).toEqual({ left: 150, top: 270 });
    // Near the top and the bottom.
    expect(popoverPlacement({ x: 100, y: 70 }, size, area).top).toBe(66);
    expect(popoverPlacement({ x: 100, y: 830 }, size, area).top).toBe(436);
    // Taller than the area: pinned to its top.
    expect(popoverPlacement({ x: 100, y: 300 }, { w: 350, h: 900 }, area).top).toBe(66);
  });
});
