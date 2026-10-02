import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { and, eq } from "drizzle-orm";
import * as decoding from "lib0/decoding";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { createChannel, deleteChannel } from "@/lib/colosseum/channel";
import { deleteColumn, moveColumn, uploadTextColumn } from "@/lib/colosseum/column";
import { db } from "@/lib/db";
import { channel, channelCanvas, column } from "@/lib/db/schema";
import { CHANNELS, seed, USERS } from "@/scripts/seed";
import { elementsOf, placedColumnIds } from "./canvas-doc";
import { channelIdFromPath, createCanvasServer, type CanvasServer } from "./canvas-server";
import { createPgCanvasStore } from "./canvas-store";
import { subscribeRealtime } from "./events";
import {
  CLOSE_ACCESS_REVOKED,
  CLOSE_CHANNEL_GONE,
  MESSAGE_CHANNEL_EVENT,
  type ChannelEvent,
} from "./protocol";

type Harness = {
  url: string;
  canvas: CanvasServer;
  close: () => Promise<void>;
};

let harness: Harness | null = null;
const providers: WebsocketProvider[] = [];
let channelId = 0;

// A real canvas server on a bare http server, with the loopback authorize call
// swapped for `?as=` so each client picks its access.
async function start({ saveDelayMs = 0 } = {}): Promise<Harness> {
  const store = createPgCanvasStore(process.env.DATABASE_URL!);
  const canvas = createCanvasServer({
    store: {
      ...store,
      save: async (id, doc) => {
        if (saveDelayMs) await new Promise((r) => setTimeout(r, saveDelayMs));
        return store.save(id, doc);
      },
    },
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
      server.close();
    },
  };
}

function connect(as: "write" | "read" | "none", id = channelId) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(harness!.url, String(id), doc, {
    params: { as },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    // Providers in one process would otherwise sync over BroadcastChannel and
    // skip the server entirely.
    disableBc: true,
  });
  providers.push(provider);
  return { doc, provider };
}

function synced(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return new Promise((resolve) => provider.once("sync", () => resolve()));
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function addBlock(doc: Y.Doc, id: string, columnId: number) {
  const el = new Y.Map<unknown>();
  el.set("type", "block");
  el.set("columnId", columnId);
  el.set("x", 0);
  el.set("y", 0);
  elementsOf(doc).set(id, el);
}

// A shape, which nothing prunes, unlike a block pointing at a missing column.
function addShape(doc: Y.Doc, id: string) {
  const el = new Y.Map<unknown>();
  el.set("type", "rect");
  el.set("x", 10);
  el.set("y", 20);
  elementsOf(doc).set(id, el);
}

function listenForEvents(provider: WebsocketProvider): ChannelEvent[] {
  const events: ChannelEvent[] = [];
  provider.messageHandlers[MESSAGE_CHANNEL_EVENT] = (_encoder, decoder) => {
    events.push(JSON.parse(decoding.readVarString(decoder)) as ChannelEvent);
  };
  return events;
}

async function storedDoc(id = channelId): Promise<Y.Doc | null> {
  const [row] = await db.select().from(channelCanvas).where(eq(channelCanvas.channel_id, id));
  if (!row) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.doc);
  return doc;
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
  harness = await start();
});

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await harness?.close();
  harness = null;
});

test("channelIdFromPath takes positive integer ids under the canvas path only", () => {
  expect(channelIdFromPath("/realtime/canvas/42")).toBe(42);
  expect(channelIdFromPath("/realtime/canvas/42?as=read")).toBe(42);
  expect(channelIdFromPath("/realtime/canvas/0")).toBeNull();
  expect(channelIdFromPath("/realtime/canvas/4x2")).toBeNull();
  expect(channelIdFromPath("/realtime/canvas/")).toBeNull();
  expect(channelIdFromPath("/_next/webpack-hmr")).toBeNull();
});

test("two editors converge on concurrent edits", async () => {
  const a = connect("write");
  const b = connect("write");
  await Promise.all([synced(a.provider), synced(b.provider)]);

  addBlock(a.doc, "from-a", 1);
  addBlock(b.doc, "from-b", 2);

  const both = (doc: Y.Doc) => elementsOf(doc).has("from-a") && elementsOf(doc).has("from-b");
  await waitFor(() => both(a.doc) && both(b.doc), "both edits on both clients");
});

test("a read-only client gets every update but its own edits never leave it", async () => {
  const editor = connect("write");
  const viewer = connect("read");
  await Promise.all([synced(editor.provider), synced(viewer.provider)]);

  addBlock(editor.doc, "by-editor", 1);
  await waitFor(() => elementsOf(viewer.doc).has("by-editor"), "the editor's edit on the viewer");

  addBlock(viewer.doc, "by-viewer", 2);
  // Give the server every chance to relay it; a later editor change that does
  // arrive proves the pipe was open the whole time.
  await new Promise((r) => setTimeout(r, 100));
  addBlock(editor.doc, "marker", 3);
  await waitFor(() => elementsOf(viewer.doc).has("marker"), "the marker on the viewer");
  expect(elementsOf(editor.doc).has("by-viewer")).toBe(false);

  // The stored doc has no trace of it either.
  await new Promise((r) => setTimeout(r, 150));
  const stored = await storedDoc();
  expect(stored && elementsOf(stored).has("by-viewer")).toBe(false);
});

test("read-only clients see editors' cursors and never appear in presence", async () => {
  const editor = connect("write");
  const viewer = connect("read");
  await Promise.all([synced(editor.provider), synced(viewer.provider)]);

  editor.provider.awareness.setLocalStateField("cursor", { x: 1, y: 2 });
  viewer.provider.awareness.setLocalStateField("cursor", { x: 9, y: 9 });

  const editorId = editor.doc.clientID;
  const viewerId = viewer.doc.clientID;
  await waitFor(
    () => viewer.provider.awareness.getStates().get(editorId)?.cursor?.x === 1,
    "the editor's cursor on the viewer",
  );
  // A second editor joining late is told about the first, never the viewer.
  const late = connect("write");
  await synced(late.provider);
  await waitFor(() => late.provider.awareness.getStates().has(editorId), "presence for late");
  expect(editor.provider.awareness.getStates().has(viewerId)).toBe(false);
  expect(late.provider.awareness.getStates().has(viewerId)).toBe(false);
});

test("the canvas saves after edits settle and reloads once everyone has left", async () => {
  const a = connect("write");
  await synced(a.provider);
  addShape(a.doc, "kept");

  await waitFor(() => harness!.canvas.roomCount() === 1, "the room to be open");
  a.provider.destroy();
  await waitFor(() => harness!.canvas.roomCount() === 0, "the idle room to unload");

  const stored = await storedDoc();
  expect(stored && elementsOf(stored).get("kept")?.get("y")).toBe(20);

  const b = connect("write");
  await synced(b.provider);
  expect(elementsOf(b.doc).get("kept")?.get("x")).toBe(10);
});

test("a client arriving while the last one's save runs joins and keeps the edit", async () => {
  await harness!.close();
  harness = await start({ saveDelayMs: 150 });

  const a = connect("write");
  await synced(a.provider);
  addShape(a.doc, "handoff");
  await new Promise((r) => setTimeout(r, 30));
  a.provider.destroy();

  const b = connect("write");
  await synced(b.provider);
  expect(elementsOf(b.doc).has("handoff")).toBe(true);
  // Still connected once the slow save has finished and the idle check ran.
  await new Promise((r) => setTimeout(r, 300));
  expect(b.provider.wsconnected).toBe(true);
  expect(harness!.canvas.roomCount()).toBe(1);
});

test("loading a canvas drops elements for blocks that are no longer in the channel", async () => {
  const [live] = await db
    .select({ id: column.id })
    .from(column)
    .where(eq(column.channel_id, channelId))
    .limit(1);

  const saved = new Y.Doc();
  addBlock(saved, "live", live.id);
  addBlock(saved, "deleted", 2_000_000_000);
  await db
    .insert(channelCanvas)
    .values({ channel_id: channelId, doc: Y.encodeStateAsUpdate(saved) });

  const a = connect("write");
  await synced(a.provider);
  expect([...placedColumnIds(a.doc)]).toEqual([live.id]);

  // The prune is itself a change, so it saves.
  await new Promise((r) => setTimeout(r, 150));
  expect([...placedColumnIds((await storedDoc())!)]).toEqual([live.id]);
});

test("deleting a block removes it from an open canvas and tells clients", async () => {
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: channelId,
    text: "canvas delete test",
  });
  const a = connect("write");
  const events = listenForEvents(a.provider);
  await synced(a.provider);
  addBlock(a.doc, "doomed", block.id);
  await waitFor(() => harness!.canvas.roomCount() === 1, "the room to be open");

  await deleteColumn(block.id);

  await waitFor(() => !elementsOf(a.doc).has("doomed"), "the element to go");
  await waitFor(
    () => events.some((e) => e.type === "block.removed" && e.columnId === block.id),
    "the block.removed event",
  );
});

test("adding and moving blocks reach open canvases on both channels", async () => {
  const [other] = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(
        eq(channel.title, CHANNELS.alicePrivate.title),
        eq(channel.owned_by, USERS.alice.ownerId),
      ),
    );
  const here = connect("write");
  const there = connect("write", other.id);
  const hereEvents = listenForEvents(here.provider);
  const thereEvents = listenForEvents(there.provider);
  await Promise.all([synced(here.provider), synced(there.provider)]);

  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: channelId,
    text: "canvas move test",
  });
  await waitFor(
    () => hereEvents.some((e) => e.type === "block.added" && e.columnId === block.id),
    "block.added here",
  );

  addBlock(here.doc, "moving", block.id);
  await new Promise((r) => setTimeout(r, 50));
  await moveColumn(block.id, other.id);

  await waitFor(() => !elementsOf(here.doc).has("moving"), "the element to leave");
  await waitFor(
    () => thereEvents.some((e) => e.type === "block.added" && e.columnId === block.id),
    "block.added there",
  );
  await deleteColumn(block.id);
});

test("deleting the channel closes its canvas for good", async () => {
  const doomed = await createChannel({
    title: "Canvas doomed",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const a = connect("write", doomed.id);
  await synced(a.provider);
  const closed = new Promise<number>((resolve) =>
    a.provider.on("connection-close", (event) => resolve(event?.code ?? 0)),
  );

  await deleteChannel(doomed.id);

  expect(await closed).toBe(CLOSE_CHANNEL_GONE);
  // 4404 is in y-websocket's no-reconnect range.
  await new Promise((r) => setTimeout(r, 100));
  expect(a.provider.wsconnected).toBe(false);
});

test("an unauthorized socket is closed with 4403 before it joins a room", async () => {
  const ws = new WebSocket(`${harness!.url}/${channelId}?as=none`);
  const messages: unknown[] = [];
  ws.onmessage = (event) => messages.push(event.data);
  const code = await new Promise<number>((resolve) => {
    ws.onclose = (event) => resolve(event.code);
  });
  expect(code).toBe(CLOSE_ACCESS_REVOKED);
  expect(messages).toEqual([]);
  expect(harness!.canvas.roomCount()).toBe(0);
});
