import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { and, eq } from "drizzle-orm";
import * as decoding from "lib0/decoding";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import {
  deleteCanvasThreadComment,
  replyToCanvasThread,
  startCanvasThread,
} from "@/lib/colosseum/canvas-thread";
import { db } from "@/lib/db";
import { canvasThread, channel, channelCanvas } from "@/lib/db/schema";
import { CHANNELS, seed, USERS } from "@/scripts/seed";
import { elementsOf } from "./canvas-doc";
import { createCanvasServer, type CanvasServer } from "./canvas-server";
import { createPgCanvasStore } from "./canvas-store";
import { createPgThreadStore } from "./canvas-thread-store";
import { elementWorldPosition, freeOrphanedThreads } from "./canvas-threads";
import { subscribeRealtime } from "./events";
import { MESSAGE_CHANNEL_EVENT, type ChannelEvent } from "./protocol";

type Harness = { url: string; canvas: CanvasServer; close: () => Promise<void> };

let harness: Harness | null = null;
const providers: WebsocketProvider[] = [];
let channelId = 0;
const threadStore = () => createPgThreadStore(process.env.DATABASE_URL!);

// The canvas-server.test.ts harness, with thread anchoring switched on.
async function start(): Promise<Harness> {
  const store = createPgCanvasStore(process.env.DATABASE_URL!);
  const threads = threadStore();
  const canvas = createCanvasServer({
    store,
    threads,
    authorize: async (req) => {
      const as = new URL(req.url!, "http://x").searchParams.get("as");
      if (as === "write") return { access: "write", userId: USERS.alice.id };
      if (as === "read") return { access: "read", userId: null };
      return null;
    },
    debounceMs: 20,
    maxWaitMs: 100,
  });
  const server: Server = createServer();
  server.on("upgrade", (req, socket, head) => {
    if (!canvas.handleUpgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const unsubscribe = subscribeRealtime((event) => canvas.handleEvent(event));
  return {
    url: `ws://127.0.0.1:${port}/realtime/canvas`,
    canvas,
    close: async () => {
      unsubscribe();
      await canvas.shutdown();
      await store.end();
      await threads.end();
      server.close();
    },
  };
}

function connect(as: "write" | "read") {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(harness!.url, String(channelId), doc, {
    params: { as },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  providers.push(provider);
  const events: ChannelEvent[] = [];
  provider.messageHandlers[MESSAGE_CHANNEL_EVENT] = (_encoder, decoder) => {
    events.push(JSON.parse(decoding.readVarString(decoder)) as ChannelEvent);
  };
  return { doc, provider, events };
}

function synced(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return new Promise((resolve) => provider.once("sync", () => resolve()));
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function addElement(doc: Y.Doc, id: string, fields: Record<string, unknown>) {
  const el = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) el.set(k, v);
  elementsOf(doc).set(id, el);
}

async function threadRow(id: number) {
  const [row] = await db.select().from(canvasThread).where(eq(canvasThread.id, id));
  return row;
}

beforeAll(async () => {
  await seed();
  const [row] = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(eq(channel.title, CHANNELS.aliceDesign.title), eq(channel.owned_by, USERS.alice.ownerId)),
    );
  channelId = row.id;
});

beforeEach(async () => {
  await db.delete(channelCanvas);
  await db.delete(canvasThread);
  harness = await start();
});

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await harness?.close();
  harness = null;
});

test("new threads, replies and deletions reach editors and read-only viewers live", async () => {
  const editor = connect("write");
  const viewer = connect("read");
  await Promise.all([synced(editor.provider), synced(viewer.provider)]);

  // bob can read alice's channel but not edit it: a read-only viewer commenting.
  const thread = await startCanvasThread({
    channelId,
    userId: USERS.bob.id,
    anchor: { x: 1, y: 2 },
    body: "From a viewer.",
  });
  const reply = await replyToCanvasThread({
    threadId: thread.id,
    userId: USERS.alice.id,
    body: "From the owner.",
  });
  await deleteCanvasThreadComment({ commentId: reply.id, userId: USERS.alice.id });
  await deleteCanvasThreadComment({ commentId: thread.starter!.id, userId: USERS.bob.id });

  // Only the thread events: a socket also gets its own `session` event on join.
  const threadEvents = (events: ChannelEvent[]) =>
    events.filter((e) => e.type.startsWith("thread."));
  for (const { events } of [editor, viewer]) {
    await waitFor(() => threadEvents(events).length === 4, "four thread events");
    expect(threadEvents(events)).toEqual([
      { type: "thread.created", thread },
      { type: "thread.comment.added", comment: reply },
      { type: "thread.comment.deleted", threadId: thread.id, commentId: reply.id },
      { type: "thread.deleted", threadId: thread.id },
    ]);
  }
});

test("a thread follows its element and stays where it was when the element is deleted", async () => {
  const editor = connect("write");
  const viewer = connect("read");
  await Promise.all([synced(editor.provider), synced(viewer.provider)]);
  addElement(editor.doc, "shape", { type: "rect", x: 10, y: 20, w: 50, h: 50 });
  await waitFor(() => elementsOf(viewer.doc).has("shape"), "the shape on the viewer");

  const thread = await startCanvasThread({
    channelId,
    userId: USERS.bob.id,
    anchor: { elementId: "shape", offsetX: 5, offsetY: 6, x: 15, y: 26 },
    body: "On the shape.",
  });
  await waitFor(() => viewer.events.some((e) => e.type === "thread.created"), "thread.created");

  // Moved twice, then deleted: the free pin lands at the last position.
  const shape = elementsOf(editor.doc).get("shape")!;
  shape.set("x", 100);
  editor.doc.transact(() => {
    shape.set("x", 200);
    shape.set("y", 300);
  });
  elementsOf(editor.doc).delete("shape");

  await waitFor(async () => (await threadRow(thread.id)).element_id === null, "the thread freed");
  expect(await threadRow(thread.id)).toMatchObject({ element_id: null, x: 205, y: 306 });
  for (const { events } of [editor, viewer]) {
    await waitFor(() => events.some((e) => e.type === "thread.detached"), "thread.detached");
    expect(events.find((e) => e.type === "thread.detached")).toEqual({
      type: "thread.detached",
      threadId: thread.id,
      x: 205,
      y: 306,
    });
  }
});

test("an undo that brings the element back pins its thread again, at the old offset", async () => {
  const editor = connect("write");
  const viewer = connect("read");
  await Promise.all([synced(editor.provider), synced(viewer.provider)]);
  addElement(editor.doc, "shape", { type: "rect", x: 10, y: 20 });
  const thread = await startCanvasThread({
    channelId,
    userId: USERS.bob.id,
    anchor: { elementId: "shape", offsetX: 5, offsetY: 6, x: 15, y: 26 },
    body: "Come back.",
  });
  await waitFor(() => viewer.events.some((e) => e.type === "thread.created"), "thread.created");

  // The editor's own undo stack, tracking only the delete.
  const undo = new Y.UndoManager(elementsOf(editor.doc));
  elementsOf(editor.doc).delete("shape");
  await waitFor(async () => (await threadRow(thread.id)).element_id === null, "the thread freed");
  expect(await threadRow(thread.id)).toMatchObject({ last_element_id: "shape", x: 15, y: 26 });

  undo.undo();
  expect(elementsOf(editor.doc).has("shape")).toBe(true);
  await waitFor(async () => (await threadRow(thread.id)).element_id === "shape", "re-pinned");
  expect(await threadRow(thread.id)).toMatchObject({
    last_element_id: null,
    offset_x: 5,
    offset_y: 6,
  });
  await waitFor(
    () => viewer.events.some((e) => e.type === "thread.attached"),
    "thread.attached on the viewer",
  );
  expect(
    viewer.events.filter((e) => e.type.startsWith("thread.") && e.type !== "thread.created"),
  ).toEqual([
    { type: "thread.detached", threadId: thread.id, x: 15, y: 26 },
    { type: "thread.attached", threadId: thread.id, elementId: "shape" },
  ]);

  // Pinned again, it follows the element and frees at its new position.
  elementsOf(editor.doc).get("shape")!.set("x", 70);
  elementsOf(editor.doc).delete("shape");
  await waitFor(async () => (await threadRow(thread.id)).element_id === null, "freed again");
  expect(await threadRow(thread.id)).toMatchObject({ x: 75, y: 26 });

  // A new element under the same id, rather than an undo, pins it too.
  addElement(editor.doc, "shape", { type: "rect", x: 0, y: 0 });
  await waitFor(async () => (await threadRow(thread.id)).element_id === "shape", "re-pinned");
});

test("a thread on an element inside a frame follows the frame", async () => {
  const editor = connect("write");
  await synced(editor.provider);
  addElement(editor.doc, "frame", { type: "frame", x: 100, y: 100, parentId: null });
  addElement(editor.doc, "child", { type: "rect", x: 10, y: 20, parentId: "frame" });
  expect(elementWorldPosition(elementsOf(editor.doc), "child")).toEqual({ x: 110, y: 120 });

  const thread = await startCanvasThread({
    channelId,
    userId: USERS.alice.id,
    anchor: { elementId: "child", offsetX: 1, offsetY: 1, x: 111, y: 121 },
    body: "Nested.",
  });
  await waitFor(() => editor.events.some((e) => e.type === "thread.created"), "thread.created");

  // Moving the frame writes the frame's position only; the child's is relative.
  elementsOf(editor.doc).get("frame")!.set("x", 300);
  elementsOf(editor.doc).delete("child");
  await waitFor(async () => (await threadRow(thread.id)).element_id === null, "the thread freed");
  expect(await threadRow(thread.id)).toMatchObject({ x: 311, y: 121 });
});

test("a pinned thread turns with its element, and frees where the turned pin was", async () => {
  const editor = connect("write");
  const viewer = connect("read");
  await Promise.all([synced(editor.provider), synced(viewer.provider)]);
  addElement(editor.doc, "card", { type: "rect", x: 100, y: 100, w: 100, h: 50, rotation: 0 });
  await waitFor(() => elementsOf(viewer.doc).has("card"), "the card on the viewer");

  // On the card's top-left corner.
  const thread = await startCanvasThread({
    channelId,
    userId: USERS.bob.id,
    anchor: { elementId: "card", offsetX: 0, offsetY: 0, x: 100, y: 100 },
    body: "Top left.",
  });
  await waitFor(() => viewer.events.some((e) => e.type === "thread.created"), "thread.created");

  // A quarter turn clockwise about the centre (150, 125) takes the top-left
  // corner to (175, 75). The rotation alone is the change the room sees.
  elementsOf(editor.doc).get("card")!.set("rotation", 90);
  elementsOf(editor.doc).delete("card");
  await waitFor(async () => (await threadRow(thread.id)).element_id === null, "the thread freed");
  const row = await threadRow(thread.id);
  expect(row.x).toBeCloseTo(175, 6);
  expect(row.y).toBeCloseTo(75, 6);
  // The stored offset stays in the card's unrotated box, for a re-pin.
  expect(row).toMatchObject({ offset_x: 0, offset_y: 0, last_element_id: "card" });
});

test("elementWorldPosition sums the parent chain and survives a loop", () => {
  const doc = new Y.Doc();
  addElement(doc, "outer", { x: 1, y: 2, parentId: null });
  addElement(doc, "inner", { x: 10, y: 20, parentId: "outer" });
  addElement(doc, "leaf", { x: 100, y: 200, parentId: "inner" });
  addElement(doc, "orphan", { x: 5, y: 5, parentId: "missing" });
  addElement(doc, "a", { x: 0, y: 0, parentId: "b" });
  addElement(doc, "b", { x: 0, y: 0, parentId: "a" });
  const elements = elementsOf(doc);
  expect(elementWorldPosition(elements, "leaf")).toEqual({ x: 111, y: 222 });
  expect(elementWorldPosition(elements, "orphan")).toEqual({ x: 5, y: 5 });
  expect(elementWorldPosition(elements, "a")).toBeNull();
  expect(elementWorldPosition(elements, "nope")).toBeNull();
});

test("a canvas that loads pins a free thread whose element is back", async () => {
  const saved = new Y.Doc();
  addElement(saved, "restored", { type: "rect", x: 40, y: 50 });
  await db
    .insert(channelCanvas)
    .values({ channel_id: channelId, doc: Y.encodeStateAsUpdate(saved) });
  const [thread] = await db
    .insert(canvasThread)
    .values({
      channel_id: channelId,
      last_element_id: "restored",
      offset_x: 1,
      offset_y: 2,
      x: 0,
      y: 0,
    })
    .returning();

  const a = connect("write");
  await synced(a.provider);
  await waitFor(async () => (await threadRow(thread.id)).element_id === "restored", "re-pinned");
});

test("a block pruned when the canvas loads frees its thread at the saved position", async () => {
  const saved = new Y.Doc();
  addElement(saved, "gone-block", { type: "block", columnId: 2_000_000_000, x: 50, y: 60 });
  await db
    .insert(channelCanvas)
    .values({ channel_id: channelId, doc: Y.encodeStateAsUpdate(saved) });
  // The stored position is stale, as it would be for a canvas edited since.
  const [thread] = await db
    .insert(canvasThread)
    .values({
      channel_id: channelId,
      element_id: "gone-block",
      offset_x: 1,
      offset_y: 2,
      x: 0,
      y: 0,
    })
    .returning();

  const a = connect("write");
  await synced(a.provider);
  expect(elementsOf(a.doc).has("gone-block")).toBe(false);
  await waitFor(async () => (await threadRow(thread.id)).element_id === null, "the thread freed");
  expect(await threadRow(thread.id)).toMatchObject({ x: 51, y: 62 });
});

test("a thread pinned to an element that's already gone is freed where it was placed", async () => {
  const a = connect("write");
  await synced(a.provider);
  const thread = await startCanvasThread({
    channelId,
    userId: USERS.alice.id,
    anchor: { elementId: "ghost", offsetX: 0, offsetY: 0, x: 7, y: 8 },
    body: "Too late.",
  });
  await waitFor(async () => (await threadRow(thread.id)).element_id === null, "the thread freed");
  expect(await threadRow(thread.id)).toMatchObject({ x: 7, y: 8 });
  await waitFor(() => a.events.some((e) => e.type === "thread.detached"), "thread.detached");
});

test("pinned threads' latest positions are saved when the canvas unloads", async () => {
  const a = connect("write");
  await synced(a.provider);
  addElement(a.doc, "moving", { type: "sticky", x: 0, y: 0 });
  const thread = await startCanvasThread({
    channelId,
    userId: USERS.alice.id,
    anchor: { elementId: "moving", offsetX: 1, offsetY: 1, x: 1, y: 1 },
    body: "Along for the ride.",
  });
  await waitFor(() => a.events.some((e) => e.type === "thread.created"), "thread.created");
  elementsOf(a.doc).get("moving")!.set("x", 40);

  await waitFor(() => harness!.canvas.roomCount() === 1, "the room to be open");
  a.provider.destroy();
  await waitFor(() => harness!.canvas.roomCount() === 0, "the idle room to unload");
  await waitFor(async () => (await threadRow(thread.id)).x === 41, "the position saved");
  expect(await threadRow(thread.id)).toMatchObject({ element_id: "moving", x: 41, y: 1 });
});

test("freeOrphanedThreads frees threads a restore dropped, once", async () => {
  // No canvas open: a restore written straight to storage.
  const [thread] = await db
    .insert(canvasThread)
    .values({ channel_id: channelId, element_id: "dropped", offset_x: 2, offset_y: 3, x: 0, y: 0 })
    .returning();
  const [kept] = await db
    .insert(canvasThread)
    .values({ channel_id: channelId, element_id: "kept", offset_x: 0, offset_y: 0, x: 9, y: 9 })
    .returning();

  const before = new Y.Doc();
  addElement(before, "dropped", { type: "rect", x: 30, y: 40 });
  addElement(before, "kept", { type: "rect", x: 9, y: 9 });
  const after = new Y.Doc();
  addElement(after, "kept", { type: "rect", x: 9, y: 9 });

  const store = threadStore();
  try {
    const freed = await freeOrphanedThreads({ store, channelId, doc: after, previous: before });
    expect(freed).toEqual([{ threadId: thread.id, x: 32, y: 43 }]);
    expect(await threadRow(thread.id)).toMatchObject({ element_id: null, x: 32, y: 43 });
    expect((await threadRow(kept.id)).element_id).toBe("kept");

    expect(await freeOrphanedThreads({ store, channelId, doc: after })).toEqual([]);
  } finally {
    await store.end();
  }
});
