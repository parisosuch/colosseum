import { afterEach, beforeAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { and, eq } from "drizzle-orm";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { startCanvasThread } from "@/lib/colosseum/canvas-thread";
import { db } from "@/lib/db";
import { canvasThread, channel } from "@/lib/db/schema";
import { CHANNELS, seed, USERS } from "@/scripts/seed";
import { elementsOf } from "./canvas-doc";
import { createCanvasHistory, type CanvasHistory } from "./canvas-history";
import { createPgVersionStore } from "./canvas-history-store";
import { createCanvasServer } from "./canvas-server";
import { createPgCanvasStore } from "./canvas-store";
import { createPgThreadStore } from "./canvas-thread-store";
import { subscribeRealtime } from "./events";

// A restore runs inside the channel's room (withDoc), where thread anchoring
// is attached, so threads follow it the way they follow any edit: an element
// the restore removes frees its threads, and one it brings back pins them
// again. Nothing calls onElementsRemoved for this; these tests hold that up.

let channelId = 0;
let harness: { url: string; history: CanvasHistory; close: () => Promise<void> } | null = null;
const providers: WebsocketProvider[] = [];

async function start() {
  const url = process.env.DATABASE_URL!;
  const store = createPgCanvasStore(url);
  const threads = createPgThreadStore(url);
  const versions = createPgVersionStore(url);
  const canvas = createCanvasServer({
    store,
    threads,
    authorize: async () => ({ access: "write", userId: USERS.alice.id }),
    debounceMs: 20,
    maxWaitMs: 100,
  });
  const history = createCanvasHistory({ versions, canvases: store, docs: canvas, quietMs: 60_000 });
  // As server.ts wires it.
  canvas.onEdit((channel, userId) => history.recordEdit(channel, userId));
  const server: Server = createServer();
  server.on("upgrade", (req, socket, head) => {
    if (!canvas.handleUpgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const unsubscribe = subscribeRealtime((event) => canvas.handleEvent(event));
  return {
    url: `ws://127.0.0.1:${port}/realtime/canvas`,
    history,
    close: async () => {
      unsubscribe();
      await history.shutdown();
      await canvas.shutdown();
      await store.end();
      await threads.end();
      await versions.end();
      server.close();
    },
  };
}

function connect() {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(harness!.url, String(channelId), doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  providers.push(provider);
  return { doc, provider };
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
  harness = await start();
});

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await harness?.close();
  harness = await start();
});

test("a restore that drops an element frees its thread, and restoring it back pins it again", async () => {
  const { doc, provider } = connect();
  await synced(provider);

  // Before the note exists.
  const without = await harness!.history.saveRestorePoint(channelId, "empty", USERS.alice.id);

  const note = new Y.Map<unknown>();
  for (const [k, v] of Object.entries({ type: "sticky", x: 400, y: 300, w: 120, h: 80 })) {
    note.set(k, v);
  }
  elementsOf(doc).set("note-1", note);
  await waitFor(() => harness!.history.pendingChannels().includes(channelId), "the edit");
  const withNote = await harness!.history.saveRestorePoint(channelId, "note", USERS.alice.id);

  const thread = await startCanvasThread({
    channelId,
    userId: USERS.alice.id,
    anchor: { elementId: "note-1", offsetX: 10, offsetY: 20, x: 410, y: 320 },
    body: "about this note",
  });
  // The open room picks the new thread up and tracks its element.
  await waitFor(async () => (await threadRow(thread.id)).element_id === "note-1", "pinned");

  await harness!.history.restore(channelId, without!, USERS.alice.id);
  await waitFor(() => !elementsOf(doc).has("note-1"), "the restore to reach the client");
  await waitFor(async () => (await threadRow(thread.id)).element_id === null, "the thread freed");
  const freed = await threadRow(thread.id);
  expect(freed.last_element_id).toBe("note-1");
  expect([freed.x, freed.y]).toEqual([410, 320]);

  await harness!.history.restore(channelId, withNote!, USERS.alice.id);
  await waitFor(() => elementsOf(doc).has("note-1"), "the element back on the client");
  await waitFor(
    async () => (await threadRow(thread.id)).element_id === "note-1",
    "the thread pinned again",
  );
  const pinned = await threadRow(thread.id);
  expect([pinned.offset_x, pinned.offset_y]).toEqual([10, 20]);
});
