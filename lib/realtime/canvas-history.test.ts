import { afterEach, beforeAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { asc, eq, sql } from "drizzle-orm";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { createChannel } from "@/lib/colosseum/channel";
import { deleteColumn, uploadTextColumn } from "@/lib/colosseum/column";
import { db } from "@/lib/db";
import { channelCanvas, channelCanvasVersion } from "@/lib/db/schema";
import { seed, USERS } from "@/scripts/seed";
import { elementsOf } from "./canvas-doc";
import {
  createCanvasHistory,
  restoreElements,
  storedDocs,
  type CanvasDocs,
  type CanvasHistory,
  type RemovedElement,
} from "./canvas-history";
import { createPgVersionStore } from "./canvas-history-store";
import { startRetention } from "./canvas-retention";
import { createCanvasServer, type CanvasServer } from "./canvas-server";
import { createPgCanvasStore } from "./canvas-store";
import { subscribeRealtime } from "./events";

type Harness = {
  url: string;
  canvas: CanvasServer;
  history: CanvasHistory;
  removed: { channelId: number; elements: RemovedElement[] }[];
  close: () => Promise<void>;
};

let harness: Harness | null = null;
const providers: WebsocketProvider[] = [];

// A real canvas server with history wired the way server.ts wires it, on a
// bare http server. `?as=write&user=bob` picks the client's access and user.
async function start({
  quietMs = 60_000,
  wrapDocs = (docs: CanvasDocs) => docs,
} = {}): Promise<Harness> {
  const store = createPgCanvasStore(process.env.DATABASE_URL!);
  const versions = createPgVersionStore(process.env.DATABASE_URL!);
  const canvas = createCanvasServer({
    store,
    authorize: async (req) => {
      const params = new URL(req.url!, "http://x").searchParams;
      const userId = params.get("user") === "bob" ? USERS.bob.id : USERS.alice.id;
      if (params.get("as") === "write") return { access: "write", userId };
      if (params.get("as") === "read") return { access: "read", userId: null };
      return null;
    },
    debounceMs: 20,
    maxWaitMs: 100,
  });
  const removed: Harness["removed"] = [];
  const history = createCanvasHistory({
    versions,
    canvases: store,
    docs: wrapDocs(canvas),
    quietMs,
    onElementsRemoved: (channelId, elements) => {
      removed.push({ channelId, elements });
    },
  });
  const stopEdits = canvas.onEdit((channelId, userId) => history.recordEdit(channelId, userId));
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
    history,
    removed,
    close: async () => {
      unsubscribe();
      stopEdits();
      await history.shutdown();
      await canvas.shutdown();
      await versions.end();
      await store.end();
      server.close();
    },
  };
}

function connect(channelId: number, user: "alice" | "bob" = "alice", as = "write") {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(harness!.url, String(channelId), doc, {
    params: { as, user },
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
    await sleep(10);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function addShape(doc: Y.Doc, id: string, x = 10) {
  const el = new Y.Map<unknown>();
  el.set("type", "rect");
  el.set("x", x);
  el.set("y", 20);
  el.set("w", 30);
  el.set("h", 40);
  elementsOf(doc).set(id, el);
}

function addBlock(doc: Y.Doc, id: string, columnId: number) {
  const el = new Y.Map<unknown>();
  el.set("type", "block");
  el.set("columnId", columnId);
  el.set("x", 0);
  el.set("y", 0);
  elementsOf(doc).set(id, el);
}

const ids = (doc: Y.Doc) => [...elementsOf(doc).keys()].sort();

function decode(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

async function versionsOf(channelId: number) {
  return db
    .select()
    .from(channelCanvasVersion)
    .where(eq(channelCanvasVersion.channel_id, channelId))
    .orderBy(asc(channelCanvasVersion.id));
}

async function storedDoc(channelId: number): Promise<Y.Doc | null> {
  const [row] = await db
    .select()
    .from(channelCanvas)
    .where(eq(channelCanvas.channel_id, channelId));
  return row ? decode(row.doc) : null;
}

// The server has the edits once they're saved (20ms debounce in the harness).
async function untilStored(channelId: number, expected: string) {
  await waitFor(async () => {
    const doc = await storedDoc(channelId);
    return !!doc && ids(doc).join() === expected;
  }, `"${expected}" in storage`);
}

let channelSeq = 0;
async function freshChannel() {
  const ch = await createChannel({
    title: `History canvas ${++channelSeq}`,
    access: "open",
    owned_by: USERS.alice.ownerId,
  });
  return ch.id;
}

beforeAll(async () => {
  await seed();
});

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  await harness?.close();
  harness = null;
});

// ---------------------------------------------------------------------------
// The restore itself, on plain docs.
// ---------------------------------------------------------------------------

test("restoreElements reverts deletes, moves, text and additions as one new change", () => {
  const live = new Y.Doc();
  addShape(live, "kept", 1);
  addShape(live, "moved", 2);
  addShape(live, "deleted", 3);
  const note = new Y.Map<unknown>();
  note.set("type", "text");
  const text = new Y.Text("hello");
  note.set("text", text);
  elementsOf(live).set("note", note);
  const version = Y.encodeStateAsUpdate(live);

  // Another client wrecks it.
  const vandal = decode(Y.encodeStateAsUpdate(live));
  const els = elementsOf(vandal);
  els.get("moved")!.set("x", 999);
  els.delete("deleted");
  (els.get("note")!.get("text") as Y.Text).delete(0, 5);
  addShape(vandal, "scribble", 50);
  Y.applyUpdate(live, Y.encodeStateAsUpdate(vandal, Y.encodeStateVector(live)));

  let updates = 0;
  live.on("update", () => updates++);
  const removed = restoreElements(live, version, () => true, "test");

  expect(updates).toBe(1);
  expect(ids(live)).toEqual(["deleted", "kept", "moved", "note"]);
  expect(elementsOf(live).get("moved")!.get("x")).toBe(2);
  expect(elementsOf(live).get("deleted")!.get("x")).toBe(3);
  expect(String(elementsOf(live).get("note")!.get("text"))).toBe("hello");
  expect(removed).toEqual([{ id: "scribble", type: "rect", x: 50, y: 20, w: 30, h: 40 }]);

  // The vandal's doc merges the restore like any edit, and restoring the
  // wrecked state again works from there.
  Y.applyUpdate(vandal, Y.encodeStateAsUpdate(live, Y.encodeStateVector(vandal)));
  expect(ids(vandal)).toEqual(["deleted", "kept", "moved", "note"]);
});

test("restoreElements drops block elements whose column is gone", () => {
  const live = new Y.Doc();
  addBlock(live, "alive", 1);
  addBlock(live, "dead", 2);
  addShape(live, "shape");
  const version = Y.encodeStateAsUpdate(live);
  elementsOf(live).delete("alive");
  elementsOf(live).delete("dead");

  const removed = restoreElements(live, version, (id) => id === 1, "test");
  expect(ids(live)).toEqual(["alive", "shape"]);
  // Neither block was on the canvas just before, so nothing was removed.
  expect(removed).toEqual([]);
});

// ---------------------------------------------------------------------------
// Automatic versions.
// ---------------------------------------------------------------------------

test("an editing session writes one version once it goes quiet, naming its editors", async () => {
  harness = await start({ quietMs: 250 });
  const channelId = await freshChannel();
  const a = connect(channelId, "alice");
  const b = connect(channelId, "bob");
  const viewer = connect(channelId, "bob", "read");
  await Promise.all([synced(a.provider), synced(b.provider), synced(viewer.provider)]);

  addShape(a.doc, "from-alice");
  await sleep(150);
  addShape(b.doc, "from-bob");
  // A read-only client's edit is dropped, so it can't name anyone.
  addShape(viewer.doc, "from-viewer");
  await waitFor(() => elementsOf(a.doc).has("from-bob"), "bob's edit at alice");

  // 300ms after alice's edit, but bob's is only ~150ms old: still one session.
  await sleep(150);
  expect(await versionsOf(channelId)).toHaveLength(0);

  await waitFor(async () => (await versionsOf(channelId)).length === 1, "the quiet version");
  const [version] = await versionsOf(channelId);
  expect(version.name).toBeNull();
  expect(version.created_by).toBeNull();
  expect(version.editors).toEqual([USERS.alice.id, USERS.bob.id]);
  expect(ids(decode(version.doc))).toEqual(["from-alice", "from-bob"]);
  expect(harness.history.pendingChannels()).toEqual([]);

  // No edits, no more versions.
  await sleep(400);
  expect(await versionsOf(channelId)).toHaveLength(1);

  // The next session names only who edited in it.
  addShape(b.doc, "second");
  await waitFor(async () => (await versionsOf(channelId)).length === 2, "the second version");
  expect((await versionsOf(channelId))[1].editors).toEqual([USERS.bob.id]);
});

test("a session still going at shutdown is versioned on the way down", async () => {
  harness = await start({ quietMs: 60_000 });
  const channelId = await freshChannel();
  const a = connect(channelId, "bob");
  await synced(a.provider);
  addShape(a.doc, "late");
  await waitFor(() => harness!.history.pendingChannels().includes(channelId), "the session");

  await harness.close();
  harness = null;
  const versions = await versionsOf(channelId);
  expect(versions).toHaveLength(1);
  expect(versions[0].editors).toEqual([USERS.bob.id]);
  expect(ids(decode(versions[0].doc))).toEqual(["late"]);
});

// ---------------------------------------------------------------------------
// Restore.
// ---------------------------------------------------------------------------

test("a restore saves the canvas first, then reaches every connected client live", async () => {
  harness = await start();
  const channelId = await freshChannel();
  const owner = connect(channelId, "alice");
  const vandal = connect(channelId, "bob");
  await Promise.all([synced(owner.provider), synced(vandal.provider)]);

  addShape(owner.doc, "one");
  addShape(owner.doc, "two");
  await waitFor(() => elementsOf(vandal.doc).size === 2, "the shapes at bob");
  const pointId = await harness.history.saveRestorePoint(channelId, "Before", USERS.alice.id);
  expect(pointId).not.toBeNull();

  // User B deletes everything and leaves a scribble.
  vandal.doc.transact(() => {
    for (const id of [...elementsOf(vandal.doc).keys()]) elementsOf(vandal.doc).delete(id);
  });
  addShape(vandal.doc, "scribble");
  await waitFor(() => ids(owner.doc).join() === "scribble", "the wipe at alice");

  const result = await harness.history.restore(channelId, pointId!, USERS.alice.id);
  expect(result?.removedElements).toBe(1);

  await waitFor(() => ids(owner.doc).join() === "one,two", "the restore at alice");
  await waitFor(() => ids(vandal.doc).join() === "one,two", "the restore at bob");

  // The version written right before holds the wiped canvas and names bob.
  const versions = await versionsOf(channelId);
  expect(versions.map((v) => v.name)).toEqual(["Before", null]);
  expect(versions[0].created_by).toBe(USERS.alice.id);
  const backup = versions[1];
  expect(backup.id).toBe(result!.backupId);
  expect(backup.created_by).toBeNull();
  expect(backup.editors).toEqual([USERS.bob.id]);
  expect(ids(decode(backup.doc))).toEqual(["scribble"]);

  // The scribble was the only element the restore took away.
  expect(harness.removed).toEqual([
    {
      channelId,
      elements: [{ id: "scribble", type: "rect", x: 10, y: 20, w: 30, h: 40 }],
    },
  ]);
  // The restore is alice's edit for the next version.
  expect(harness.history.pendingChannels()).toEqual([channelId]);

  // And it was saved.
  await untilStored(channelId, "one,two");
});

test("restoring a canvas nobody has open restores the stored doc", async () => {
  harness = await start();
  const channelId = await freshChannel();
  const a = connect(channelId);
  await synced(a.provider);
  addShape(a.doc, "original");
  await untilStored(channelId, "original");
  const pointId = await harness.history.saveRestorePoint(channelId, "Clean", USERS.alice.id);
  elementsOf(a.doc).delete("original");
  addShape(a.doc, "replacement");
  await untilStored(channelId, "replacement");
  a.provider.destroy();
  await waitFor(() => harness!.canvas.roomCount() === 0, "the room to unload");

  const result = await harness.history.restore(channelId, pointId!, USERS.alice.id);
  expect(result?.removedElements).toBe(1);
  // The room it borrowed is unloaded again.
  await waitFor(() => harness!.canvas.roomCount() === 0, "the borrowed room to unload");

  const stored = await storedDoc(channelId);
  expect(ids(stored!)).toEqual(["original"]);
  const versions = await versionsOf(channelId);
  expect(ids(decode(versions.at(-1)!.doc))).toEqual(["replacement"]);

  const b = connect(channelId);
  await synced(b.provider);
  expect(ids(b.doc)).toEqual(["original"]);
});

test("a restore drops block elements for blocks deleted since the version", async () => {
  harness = await start();
  const channelId = await freshChannel();
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: channelId,
    text: "soon gone",
  });
  const keeper = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: channelId,
    text: "stays",
  });
  const a = connect(channelId);
  await synced(a.provider);
  addBlock(a.doc, "gone-block", block.id);
  addBlock(a.doc, "kept-block", keeper.id);
  addShape(a.doc, "shape");
  await untilStored(channelId, "gone-block,kept-block,shape");
  const pointId = await harness.history.saveRestorePoint(channelId, "With block", USERS.alice.id);

  a.doc.transact(() => {
    for (const id of [...elementsOf(a.doc).keys()]) elementsOf(a.doc).delete(id);
  });
  await deleteColumn(block.id);

  await harness.history.restore(channelId, pointId!, USERS.alice.id);
  await waitFor(() => ids(a.doc).join() === "kept-block,shape", "the restore without the block");
});

test("an edit landing between the backup and the restore ends up in the backup", async () => {
  let calls = 0;
  harness = await start({
    wrapDocs: (docs) => ({
      withDoc(channelId, fn) {
        // The restore's second visit: someone edits just before it.
        if (++calls === 3) {
          return docs.withDoc(channelId, (doc) => {
            addShape(doc, "sneaky");
            return fn(doc);
          });
        }
        return docs.withDoc(channelId, fn);
      },
    }),
  });
  const channelId = await freshChannel();
  // Call 1: the restore point.
  const pointId = await harness.history.saveRestorePoint(channelId, "Empty", USERS.alice.id);
  // Calls 2 and 3: the backup, then the restore.
  await harness.history.restore(channelId, pointId!, USERS.alice.id);

  const backup = (await versionsOf(channelId)).at(-1)!;
  expect(ids(decode(backup.doc))).toEqual(["sneaky"]);
  expect(ids((await storedDoc(channelId))!)).toEqual([]);
});

test("restore refuses a version from another channel", async () => {
  harness = await start();
  const one = await freshChannel();
  const two = await freshChannel();
  const pointId = await harness.history.saveRestorePoint(one, "Mine", USERS.alice.id);
  expect(await harness.history.restore(two, pointId!, USERS.alice.id)).toBeNull();
  expect(await harness.history.preview(two, pointId!)).toBeNull();
  expect(await versionsOf(two)).toHaveLength(0);
});

test("with no realtime server, history works on the stored doc", async () => {
  const store = createPgCanvasStore(process.env.DATABASE_URL!);
  const versions = createPgVersionStore(process.env.DATABASE_URL!);
  const history = createCanvasHistory({ versions, canvases: store, docs: storedDocs(store) });
  try {
    const channelId = await freshChannel();
    const block = await uploadTextColumn({
      created_by: USERS.alice.id,
      channel_id: channelId,
      text: "doomed",
    });
    const doc = new Y.Doc();
    addShape(doc, "first");
    addBlock(doc, "block", block.id);
    await store.save(channelId, Y.encodeStateAsUpdate(doc));
    const pointId = await history.saveRestorePoint(channelId, "First", USERS.alice.id);

    elementsOf(doc).delete("first");
    addShape(doc, "second");
    await store.save(channelId, Y.encodeStateAsUpdate(doc));
    await deleteColumn(block.id);

    // The preview already leaves the deleted block out.
    expect(ids(decode((await history.preview(channelId, pointId!))!))).toEqual(["first"]);

    const result = await history.restore(channelId, pointId!, USERS.alice.id);
    // "second" goes; the block was pruned on load, before the restore.
    expect(result?.removedElements).toBe(1);
    expect(ids((await storedDoc(channelId))!)).toEqual(["first"]);
    expect(ids(decode((await versionsOf(channelId)).at(-1)!.doc))).toEqual(["second"]);
  } finally {
    await history.shutdown();
    await versions.end();
    await store.end();
  }
});

// ---------------------------------------------------------------------------
// Retention against Postgres.
// ---------------------------------------------------------------------------

test("retention thins automatic versions in Postgres and leaves named points", async () => {
  const channelId = await freshChannel();
  const now = new Date("2026-10-02T12:00:00.000Z");
  const daysAgo = (d: number, h = 0) => new Date(now.getTime() - (d * 24 + h) * 3_600_000);
  const doc = Y.encodeStateAsUpdate(new Y.Doc());
  const insert = (createdAt: Date, name: string | null = null) =>
    db
      .insert(channelCanvasVersion)
      .values({ channel_id: channelId, doc, name, editors: [], created_at: createdAt })
      .returning({ id: channelCanvasVersion.id })
      .then(([r]) => r.id);

  const recent = await insert(daysAgo(1));
  const dayLate = await insert(daysAgo(20));
  const dayEarly = await insert(daysAgo(20, 2));
  const expired = await insert(daysAgo(91));
  const namedOld = await insert(daysAgo(200), "Launch");
  const namedSameDay = await insert(daysAgo(20, 1), "Midday");

  const versions = createPgVersionStore(process.env.DATABASE_URL!);
  const retention = startRetention(versions, { now: () => now });
  try {
    await retention.run();
  } finally {
    retention.stop();
    await versions.end();
  }
  const left = (await versionsOf(channelId)).map((v) => v.id);
  expect(left).toEqual([recent, dayLate, namedOld, namedSameDay]);
  expect(left).not.toContain(dayEarly);
  expect(left).not.toContain(expired);
});

// ---------------------------------------------------------------------------
// Size, for the record: TOAST compresses the stored doc.
// ---------------------------------------------------------------------------

test("a version's doc is stored as bytea and reported by octet_length", async () => {
  const channelId = await freshChannel();
  const doc = new Y.Doc();
  addShape(doc, "a");
  const state = Y.encodeStateAsUpdate(doc);
  await db.insert(channelCanvasVersion).values({ channel_id: channelId, doc: state, editors: [] });
  const [row] = await db
    .select({ size: sql<number>`octet_length(${channelCanvasVersion.doc})`.mapWith(Number) })
    .from(channelCanvasVersion)
    .where(eq(channelCanvasVersion.channel_id, channelId));
  expect(row.size).toBe(state.byteLength);
});
