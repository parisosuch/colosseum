// What a misbehaving or unlucky client can do to the canvas server: readers
// asking for the doc over and over, sockets that stop reading, writers sending
// too much or the wrong shape, saves and loads failing, handshakes dropped.
// Real y-websocket clients where a browser would be, raw sockets where an
// attacker would be.

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { connect as tcpConnect, type AddressInfo, type Socket } from "node:net";

import { and, eq, sql } from "drizzle-orm";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { createChannel } from "@/lib/colosseum/channel";
import { deleteColumn, uploadTextColumn } from "@/lib/colosseum/column";
import { db } from "@/lib/db";
import { channel, channelCanvas } from "@/lib/db/schema";
import { CHANNELS, seed, USERS } from "@/scripts/seed";
import { elementsOf } from "./canvas-doc";
import {
  createCanvasServer,
  type CanvasLimits,
  type CanvasServer,
  type CanvasStore,
} from "./canvas-server";
import { createPgCanvasStore } from "./canvas-store";
import { subscribeRealtime } from "./events";
import {
  CLOSE_EDIT_REFUSED,
  MESSAGE_CHANNEL_EVENT,
  MESSAGE_SYNC,
  type EditRefusedEvent,
} from "./protocol";

const MiB = 1024 * 1024;

type Faults = {
  failSaves: boolean;
  failLoads: boolean;
  delayAuthorizeMs: number;
  saves: number;
};

type Harness = {
  url: string;
  port: number;
  canvas: CanvasServer;
  faults: Faults;
  close: () => Promise<void>;
};

let harness: Harness | null = null;
const providers: WebsocketProvider[] = [];
const rawSockets: Socket[] = [];
let channelId = 0;

async function start(
  opts: { limits?: Partial<CanvasLimits>; retryBaseMs?: number } = {},
): Promise<Harness> {
  const pg = createPgCanvasStore(process.env.DATABASE_URL!);
  const faults: Faults = { failSaves: false, failLoads: false, delayAuthorizeMs: 0, saves: 0 };
  const store: CanvasStore = {
    load: async (id) => {
      if (faults.failLoads) throw new Error("load is down");
      return pg.load(id);
    },
    save: async (id, doc, hasElements) => {
      faults.saves++;
      if (faults.failSaves) throw new Error("save is down");
      return pg.save(id, doc, hasElements);
    },
    columnIds: (id) => pg.columnIds(id),
  };
  const canvas = createCanvasServer({
    store,
    authorize: async (req) => {
      if (faults.delayAuthorizeMs) await new Promise((r) => setTimeout(r, faults.delayAuthorizeMs));
      const as = new URL(req.url!, "http://x").searchParams.get("as");
      if (as === "write") return { access: "write", userId: USERS.alice.id };
      if (as === "read") return { access: "read", userId: null };
      return null;
    },
    debounceMs: 20,
    maxWaitMs: 100,
    retryBaseMs: opts.retryBaseMs ?? 20,
    retryMaxMs: 200,
    limits: opts.limits,
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
    port,
    canvas,
    faults,
    close: async () => {
      unsubscribe();
      faults.failSaves = false;
      await canvas.shutdown();
      await pg.end();
      server.close();
    },
  };
}

type Client = {
  doc: Y.Doc;
  provider: WebsocketProvider;
  closes: number[];
  refusals: EditRefusedEvent["reason"][];
};

function connect(as: "write" | "read", id = channelId, doc = new Y.Doc()): Client {
  const provider = new WebsocketProvider(harness!.url, String(id), doc, {
    params: { as },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  providers.push(provider);
  const client: Client = { doc, provider, closes: [], refusals: [] };
  provider.messageHandlers[MESSAGE_CHANNEL_EVENT] = (_encoder, decoder) => {
    const event = JSON.parse(decoding.readVarString(decoder)) as { type: string };
    if (event.type === "edit.refused") client.refusals.push((event as EditRefusedEvent).reason);
  };
  provider.on("connection-close", (event) => {
    if (event) client.closes.push(event.code);
  });
  return client;
}

function synced(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return new Promise((resolve) => provider.once("sync", () => resolve()));
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A pen stroke with `numbers` coordinates, the way the canvas stores one.
function addStroke(doc: Y.Doc, id: string, numbers: number) {
  const points: number[] = [];
  for (let i = 0; i < numbers; i++) points.push(Math.round(Math.sin(i) * 4000) / 10);
  const el = new Y.Map<unknown>();
  el.set("type", "stroke");
  el.set("x", 0);
  el.set("y", 0);
  el.set("w", 100);
  el.set("h", 100);
  el.set("points", points);
  elementsOf(doc).set(id, el);
}

// A doc of `count` strokes of 150 points each, about 3.5 KB a stroke.
function strokeDoc(count: number): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (let i = 0; i < count; i++) addStroke(doc, `s${i}`, 450);
  });
  return Y.encodeStateAsUpdate(doc);
}

async function storeDoc(update: Uint8Array, hasElements = true, id = channelId) {
  await db
    .insert(channelCanvas)
    .values({ channel_id: id, doc: update, has_elements: hasElements })
    .onConflictDoUpdate({
      target: channelCanvas.channel_id,
      set: { doc: update, has_elements: hasElements },
    });
}

async function storedRow(id = channelId) {
  const [row] = await db.select().from(channelCanvas).where(eq(channelCanvas.channel_id, id));
  return row ?? null;
}

// --- raw sockets -----------------------------------------------------------

// A WebSocket client frame (masked, binary) around `payload`.
function frame(payload: Uint8Array): Buffer {
  const len = payload.length;
  const header =
    len < 126
      ? [0x82, 0x80 | len]
      : len < 65536
        ? [0x82, 0x80 | 126, len >> 8, len & 255]
        : [
            0x82,
            0x80 | 127,
            0,
            0,
            0,
            0,
            (len >>> 24) & 255,
            (len >>> 16) & 255,
            (len >>> 8) & 255,
            len & 255,
          ];
  const mask = [0x12, 0x34, 0x56, 0x78];
  const out = Buffer.alloc(header.length + 4 + len);
  out.set(header);
  out.set(mask, header.length);
  const body = header.length + 4;
  for (let i = 0; i < len; i++) out[body + i] = payload[i] ^ mask[i & 3];
  return out;
}

type Raw = {
  socket: Socket;
  // The close code the server sent, once a close frame has been read.
  closeCode: () => number | null;
  ended: () => boolean;
};

// Open a socket by hand. With `read: false` it stops reading as soon as the
// handshake is done, like a client that never drains what it's sent.
async function rawSocket(query: string, { read = true } = {}): Promise<Raw> {
  const socket = tcpConnect(harness!.port, "127.0.0.1");
  rawSockets.push(socket);
  let buf = Buffer.alloc(0);
  let upgraded = false;
  let code: number | null = null;
  let ended = false;
  socket.on("close", () => {
    ended = true;
  });
  socket.on("error", () => {});
  await new Promise<void>((resolve, reject) => {
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buf.subarray(0, end).toString();
        if (!head.startsWith("HTTP/1.1 101")) return reject(new Error(head));
        upgraded = true;
        buf = buf.subarray(end + 4);
        if (!read) socket.pause();
        resolve();
      }
      // Server frames are unmasked. Only the close frame matters here.
      while (buf.length >= 2) {
        let len = buf[1] & 127;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) return;
        if ((buf[0] & 0x0f) === 0x8 && len >= 2) code = buf.readUInt16BE(off);
        buf = buf.subarray(off + len);
      }
    });
    socket.write(
      `GET /realtime/canvas/${query} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`,
    );
  });
  return { socket, closeCode: () => code, ended: () => ended };
}

// A sync message: step 1 carries a state vector, 2 and update carry an update.
function syncMessage(step: 0 | 1 | 2, body: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, step);
  encoding.writeVarUint8Array(encoder, body);
  return encoding.toUint8Array(encoder);
}

// The longest the event loop went without running a 5ms timer.
function watchLoop() {
  let last = performance.now();
  let max = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
  }, 5);
  return () => {
    clearInterval(timer);
    return max;
  };
}

function rssMiB(): number {
  Bun.gc(true);
  return process.memoryUsage().rss / MiB;
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

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  for (const s of rawSockets.splice(0)) s.destroy();
  await harness?.close();
  harness = null;
  await db.delete(channelCanvas);
});

afterAll(async () => {
  await db.delete(channelCanvas);
});

// ---------------------------------------------------------------------------
// Readers and slow sockets.
// ---------------------------------------------------------------------------

test("sync requests from a reader that never reads don't stall the server or pile up", async () => {
  // About 4 MB, the kind of canvas a long drawing session leaves.
  await storeDoc(strokeDoc(1200));
  harness = await start();
  const before = rssMiB();
  const stalled = watchLoop();

  // 300 requests for the whole doc, 6 bytes each, from a signed-out viewer
  // who never reads the answers.
  const attacker = await rawSocket(`${channelId}?as=read`, { read: false });
  const request = frame(syncMessage(0, new Uint8Array([0])));
  for (let i = 0; i < 300; i++) attacker.socket.write(request);

  // An editor arriving meanwhile still gets in promptly.
  const t0 = performance.now();
  const editor = connect("write");
  await synced(editor.provider);
  const joinMs = performance.now() - t0;
  await sleep(1500);

  const maxStallMs = stalled();
  const grewMiB = rssMiB() - before;
  expect(elementsOf(editor.doc).size).toBe(1200);
  // Before the limits: a 38s stall and 1.1 GB more. What's left is loading
  // the doc, once on the server and once in the editor, both on this thread.
  expect(joinMs).toBeLessThan(2000);
  expect(maxStallMs).toBeLessThan(1000);
  expect(grewMiB).toBeLessThan(150);
});

test("a socket that stops reading is dropped once it falls behind on broadcasts", async () => {
  harness = await start({
    limits: {
      bufferedBytes: 1 * MiB,
      writerMessageBytes: 4 * MiB,
      byteBurst: 256 * MiB,
      bytesPerSecond: 256 * MiB,
      docBytes: 256 * MiB,
    },
  });
  const editor = connect("write");
  await synced(editor.provider);
  await rawSocket(`${channelId}?as=read`, { read: false });
  await waitFor(() => harness!.canvas.socketCount() === 2, "both sockets in the room");
  const before = rssMiB();

  // About 1 MB per edit, each replacing the last, so the doc stays small
  // while the broadcasts add up. The kernel takes the first several MB off
  // the server's hands; after that the reader's backlog sits in the server.
  for (let i = 0; i < 60 && harness.canvas.socketCount() === 2; i++) {
    editor.doc.transact(() => addStroke(editor.doc, "big", 130_000));
    await sleep(20);
  }
  await waitFor(() => harness!.canvas.socketCount() === 1, "the stalled reader to be dropped");
  expect(editor.provider.wsconnected).toBe(true);
  expect(rssMiB() - before).toBeLessThan(300);
});

// ---------------------------------------------------------------------------
// Writers.
// ---------------------------------------------------------------------------

test("an oversized edit is refused for good and never reaches the doc", async () => {
  harness = await start();
  const writer = connect("write");
  await synced(writer.provider);
  addStroke(writer.doc, "small", 300);
  await waitFor(() => harness!.canvas.socketCount() === 1, "the writer to join");
  await sleep(100);

  // About 2.7 MB, a paste of some 800 strokes in one update.
  writer.doc.transact(() => addStroke(writer.doc, "huge", 400_000));
  await waitFor(() => writer.closes.includes(CLOSE_EDIT_REFUSED), "the refusal");
  expect(writer.refusals).toEqual(["too-large"]);
  // 4413 is final: y-websocket doesn't come back and resend it.
  await sleep(300);
  expect(writer.closes).toEqual([CLOSE_EDIT_REFUSED]);
  expect(writer.provider.wsconnected).toBe(false);

  // Anyone loading the canvas sees it without the refused edit.
  const other = connect("write");
  await synced(other.provider);
  expect(elementsOf(other.doc).has("small")).toBe(true);
  expect(elementsOf(other.doc).has("huge")).toBe(false);
});

test("15 MB updates from a raw socket are refused at the first one", async () => {
  harness = await start();
  // About 13.5 MB each, under the 16 MiB a frame may be at all. Built before
  // the baseline so only the server's side is measured.
  const frames = [0, 1, 2, 3, 4].map((i) => {
    const doc = new Y.Doc();
    addStroke(doc, `junk-${i}`, 1_700_000);
    return frame(syncMessage(2, Y.encodeStateAsUpdate(doc)));
  });
  const before = rssMiB();
  const attacker = await rawSocket(`${channelId}?as=write`);
  for (const f of frames) attacker.socket.write(f);
  await waitFor(() => attacker.closeCode() !== null, "the close frame", 10_000);
  expect(attacker.closeCode()).toBe(CLOSE_EDIT_REFUSED);

  const reader = connect("read");
  await synced(reader.provider);
  expect(elementsOf(reader.doc).size).toBe(0);
  await sleep(200);
  const row = await storedRow();
  expect(row === null || row.doc.length < 1024).toBe(true);
  expect(rssMiB() - before).toBeLessThan(150);
});

test("a full canvas refuses additions but still takes deletes", async () => {
  harness = await start({ limits: { docBytes: 1 * MiB } });
  const writer = connect("write");
  await synced(writer.provider);
  // About 150 KB each; the eighth crosses 1 MiB.
  for (let i = 0; i < 12 && writer.closes.length === 0; i++) {
    writer.doc.transact(() => addStroke(writer.doc, `s${i}`, 20_000));
    await sleep(50);
  }
  await waitFor(() => writer.closes.includes(CLOSE_EDIT_REFUSED), "the refusal");
  expect(writer.refusals).toEqual(["doc-full"]);

  const fresh = connect("write");
  await synced(fresh.provider);
  const kept = [...elementsOf(fresh.doc).keys()];
  expect(kept.length).toBeGreaterThan(4);
  expect(kept.length).toBeLessThan(8);
  expect(Y.encodeStateAsUpdate(fresh.doc).length).toBeLessThanOrEqual(1 * MiB);

  // Thinning it out works, and frees room for new content.
  fresh.doc.transact(() => {
    for (const id of kept.slice(0, 3)) elementsOf(fresh.doc).delete(id);
  });
  await sleep(1100);
  addStroke(fresh.doc, "after", 300);
  const check = connect("read");
  await synced(check.provider);
  await waitFor(() => elementsOf(check.doc).has("after"), "the new stroke");
  expect(fresh.closes).toEqual([]);
  expect(elementsOf(check.doc).size).toBe(kept.length - 3 + 1);
});

test("an update that creates a top-level type the doc doesn't define is refused", async () => {
  harness = await start();
  const writer = connect("write");
  await synced(writer.provider);
  addStroke(writer.doc, "fine", 30);
  await sleep(100);
  writer.doc.getMap("junk").set("payload", "x".repeat(1000));
  await waitFor(() => writer.closes.includes(CLOSE_EDIT_REFUSED), "the refusal");
  expect(writer.refusals).toEqual(["invalid"]);

  await waitFor(() => harness!.canvas.roomCount() === 0, "the room to unload");
  const stored = new Y.Doc();
  Y.applyUpdate(stored, (await storedRow())!.doc);
  expect([...stored.share.keys()]).toEqual(["elements"]);
  expect(elementsOf(stored).has("fine")).toBe(true);
});

test("a writer over its byte budget is dropped and resyncs without losing edits", async () => {
  harness = await start({
    limits: { byteBurst: 100 * 1024, bytesPerSecond: 10 * 1024, writerMessageBytes: 256 * 1024 },
  });
  const writer = connect("write");
  await synced(writer.provider);
  // Four ~36 KB edits in quick succession: the third is over the budget. The
  // reconnect brings the last two over in one sync step 2.
  for (let i = 0; i < 4; i++) addStroke(writer.doc, `burst-${i}`, 4500);
  await waitFor(() => writer.closes.includes(1013), "the slow-down close");
  await waitFor(() => writer.provider.wsconnected, "the reconnect");

  const reader = connect("read");
  await synced(reader.provider);
  await waitFor(() => elementsOf(reader.doc).size === 4, "all four edits on the server");
  expect(writer.refusals).toEqual([]);
});

test("a flood of small messages gets the socket closed with 1013", async () => {
  harness = await start();
  const attacker = await rawSocket(`${channelId}?as=read`);
  // Awareness queries: tiny, and each one makes the server encode presence.
  const query = frame(new Uint8Array([3]));
  for (let i = 0; i < 2000; i++) attacker.socket.write(query);
  await waitFor(() => attacker.closeCode() !== null, "the close frame");
  expect(attacker.closeCode()).toBe(1013);
});

// ---------------------------------------------------------------------------
// Saving and loading.
// ---------------------------------------------------------------------------

test("a room whose last save fails stays loaded and retries until it lands", async () => {
  harness = await start();
  const writer = connect("write");
  await synced(writer.provider);
  harness.faults.failSaves = true;
  addStroke(writer.doc, "unsaved", 30);
  await waitFor(() => harness!.canvas.socketCount() === 1, "the writer to join");
  await sleep(50);
  writer.provider.destroy();

  // The disconnect save fails, and so do the retries after it.
  const failedSaves = harness.faults.saves;
  await waitFor(() => harness!.faults.saves >= failedSaves + 3, "retries");
  expect(harness.canvas.roomCount()).toBe(1);

  // The database is back: the next retry saves, then the room unloads.
  harness.faults.failSaves = false;
  await waitFor(() => harness!.canvas.roomCount() === 0, "the room to unload", 3000);
  const stored = new Y.Doc();
  Y.applyUpdate(stored, (await storedRow())!.doc);
  expect(elementsOf(stored).has("unsaved")).toBe(true);
});

test("a joiner while saves fail gets the unsaved edits", async () => {
  harness = await start({ retryBaseMs: 2000 });
  const writer = connect("write");
  await synced(writer.provider);
  harness.faults.failSaves = true;
  addStroke(writer.doc, "pending", 30);
  await sleep(100);
  writer.provider.destroy();
  await sleep(100);

  const next = connect("write");
  await synced(next.provider);
  expect(elementsOf(next.doc).has("pending")).toBe(true);
});

test("withDoc throws when its save fails instead of reporting success", async () => {
  harness = await start();
  harness.faults.failSaves = true;
  await expect(
    harness.canvas.withDoc(channelId, (doc) => addStroke(doc, "restored", 30)),
  ).rejects.toThrow(/saving canvas/);
  // The change is still live and lands once saving works again.
  expect(harness.canvas.roomCount()).toBe(1);
  harness.faults.failSaves = false;
  await waitFor(() => harness!.canvas.roomCount() === 0, "the room to unload", 3000);
  const stored = new Y.Doc();
  Y.applyUpdate(stored, (await storedRow())!.doc);
  expect(elementsOf(stored).has("restored")).toBe(true);
});

test("a failed load tears the room down, awareness timer included", async () => {
  harness = await start();
  harness.faults.failLoads = true;
  // Count the intervals started and cleared while the room loads and fails.
  const live = new Set<unknown>();
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  // The client's own awareness timer starts here, before counting begins.
  const writer = connect("write");
  globalThis.setInterval = ((fn: () => void, ms?: number) => {
    const handle = realSet(fn, ms);
    live.add(handle);
    return handle;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle: ReturnType<typeof setInterval>) => {
    live.delete(handle);
    realClear(handle);
  }) as typeof clearInterval;
  try {
    await waitFor(() => writer.closes.includes(1011), "the load-failed close");
    writer.provider.destroy();
    // y-websocket's own timers are cleared by destroy; the room's must be too.
    await sleep(50);
    expect(live.size).toBe(0);
    expect(harness.canvas.roomCount()).toBe(0);
  } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }

  harness.faults.failLoads = false;
  const again = connect("write");
  await synced(again.provider);
  expect(harness.canvas.roomCount()).toBe(1);
});

// A channel of its own, so no room another test file left open on the shared
// one saves over the doc these tests write.
async function freshChannel(title: string): Promise<number> {
  const created = await createChannel({ title, access: "public", owned_by: USERS.alice.ownerId });
  return created.id;
}

test("removing a canvas's last block while it's closed clears has_elements", async () => {
  harness = await start();
  const id = await freshChannel("Canvas closed prune");
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: id,
    text: "closed canvas prune",
  });
  const saved = new Y.Doc();
  const el = new Y.Map<unknown>();
  el.set("type", "block");
  el.set("columnId", block.id);
  elementsOf(saved).set("only", el);
  await storeDoc(Y.encodeStateAsUpdate(saved), true, id);

  await deleteColumn(block.id);
  let row = (await storedRow(id))!;
  for (let tries = 0; row.has_elements && tries < 100; tries++) {
    await sleep(20);
    row = (await storedRow(id))!;
  }
  expect(row.has_elements).toBe(false);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.doc);
  expect(elementsOf(doc).size).toBe(0);
  // Done against storage: no room was loaded for it.
  expect(harness.canvas.roomCount()).toBe(0);
});

test("removing a block that isn't on a closed canvas doesn't rewrite it", async () => {
  harness = await start();
  const id = await freshChannel("Canvas closed no-op prune");
  await storeDoc(strokeDoc(3), true, id);
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: id,
    text: "not on the canvas",
  });
  await deleteColumn(block.id);
  await sleep(200);
  expect(harness.faults.saves).toBe(0);
  expect((await storedRow(id))!.has_elements).toBe(true);
});

// ---------------------------------------------------------------------------
// Handshakes.
// ---------------------------------------------------------------------------

test("a client that hangs up while it's being authorized leaves nothing behind", async () => {
  harness = await start();
  harness.faults.delayAuthorizeMs = 100;
  const rejections: unknown[] = [];
  const onRejection = (err: unknown) => {
    rejections.push(err);
  };
  // Typed as Bun's process, whose overloads don't list this event.
  const proc = process as unknown as import("node:events").EventEmitter;
  proc.on("unhandledRejection", onRejection);
  try {
    for (const as of ["write", "none"]) {
      const socket = tcpConnect(harness.port, "127.0.0.1");
      socket.on("error", () => {});
      await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
      socket.write(
        `GET /realtime/canvas/${channelId}?as=${as} HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
      await sleep(10);
      socket.destroy();
    }
    await sleep(300);
    expect(rejections).toEqual([]);
    expect(harness.canvas.roomCount()).toBe(0);
  } finally {
    proc.off("unhandledRejection", onRejection);
  }

  harness.faults.delayAuthorizeMs = 0;
  const writer = connect("write");
  await synced(writer.provider);
});

// ---------------------------------------------------------------------------
// Schema.
// ---------------------------------------------------------------------------

test("notification.thread_id is indexed", async () => {
  const rows = await db.execute<{ indexname: string }>(
    sql`select indexname from pg_indexes where tablename = 'notification' and indexdef like '%(thread_id)%'`,
  );
  expect([...rows].map((r) => r.indexname)).toEqual(["notification_thread_id_idx"]);
});
