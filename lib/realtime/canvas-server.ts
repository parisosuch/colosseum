// The canvas side of the realtime server: one Yjs room per open channel, synced
// with y-websocket's protocol over the sockets server.ts hands in.
//
// Everything this needs from the app — who may connect, where docs live, which
// blocks a channel still has — comes in through `authorize` and `store`, so the
// module runs without Next or the data layer (both of which import
// `server-only`) and the tests can drive it against a bare http server.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { ELEMENTS_KEY, elementsOf, removeBlockElements } from "./canvas-doc";
import { affects, isAccessEvent } from "./canvas-permissions";
import {
  claimClientId,
  presenceFor,
  stampAwarenessUpdate,
  type PresenceUser,
} from "./canvas-presence";
import {
  attachThreadAnchors,
  isThreadEvent,
  toThreadChannelEvent,
  type ThreadAnchors,
  type ThreadAnchorStore,
} from "./canvas-threads";
import type { RealtimeEvent } from "./events";
import {
  CANVAS_PATH,
  CLOSE_ACCESS_REVOKED,
  CLOSE_CHANNEL_GONE,
  CLOSE_EDIT_REFUSED,
  encodeChannelEvent,
  MESSAGE_AWARENESS,
  MESSAGE_CHANNEL_EVENT,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  type ChannelEvent,
  type EditRefusedEvent,
} from "./protocol";

// `write` is anyone who can contribute to the channel. `read` is anyone else
// who can read it, signed-out viewers included: they receive every update and
// the editors' cursors, and the server drops whatever they send besides a sync
// request, so they can't edit and never show up in presence.
export type CanvasAccess = "read" | "write";

// `handle` and `avatarUrl` are the signed-in user's, for their presence
// identity (canvas-presence.ts). Only editors need them.
export type Authorization = {
  access: CanvasAccess;
  userId: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
};

export interface CanvasStore {
  load(channelId: number): Promise<Uint8Array | null>;
  // "gone" when the channel no longer exists (its row was deleted under us).
  // `hasElements`: whether the doc holds any element, stored next to it so the
  // channel page can tell an empty canvas without loading it.
  save(channelId: number, doc: Uint8Array, hasElements: boolean): Promise<"ok" | "gone">;
  // Ids of the blocks the channel holds right now.
  columnIds(channelId: number): Promise<Set<number>>;
}

export type CanvasServerOptions = {
  store: CanvasStore;
  // Null rejects the upgrade: the channel doesn't exist, or the viewer can't
  // read it. The two aren't told apart, same as the channel page.
  authorize: (req: IncomingMessage, channelId: number) => Promise<Authorization | null>;
  // Comment threads pinned to elements (canvas-threads.ts). Without it, rooms
  // still relay thread events but don't free a thread whose element is deleted.
  threads?: ThreadAnchorStore;
  // Save this long after the last change...
  debounceMs?: number;
  // ...but never later than this after the first unsaved one, so a long
  // continuous edit still lands.
  maxWaitMs?: number;
  pingIntervalMs?: number;
  // First wait before retrying a failed save; it doubles per failure up to
  // `retryMaxMs`.
  retryBaseMs?: number;
  retryMaxMs?: number;
  limits?: Partial<CanvasLimits>;
};

const KiB = 1024;
const MiB = 1024 * KiB;

// What one socket may send and hold, and how big a canvas may grow. Sockets
// are limited one by one; a client that reconnects starts with fresh budgets
// but pays for a new handshake and authorize each time.
export type CanvasLimits = {
  // Largest message a writer may send. Edits from the canvas are small (a
  // 2,000-point pen stroke is 42 KB), but a paste of canvas elements arrives
  // as one update: 500 average strokes are 1.7 MB, 5,000 shapes about 1.9 MB.
  // A writer over this is refused (CLOSE_EDIT_REFUSED).
  writerMessageBytes: number;
  // Readers only send state vectors, about 10 bytes per client id the doc has
  // seen.
  readerMessageBytes: number;
  // Token buckets per socket: a steady rate and the burst allowed on top. Over
  // either, the socket is closed with 1013, which y-websocket retries; the
  // client resends whatever the server lacks once it's back.
  messagesPerSecond: number;
  messageBurst: number;
  bytesPerSecond: number;
  byteBurst: number;
  // Requests for the full state (sync step 1). A client sends one per
  // connection; requests past the budget are ignored.
  syncRequestsPerMinute: number;
  syncRequestBurst: number;
  // Ceiling on a canvas's encoded size. Updates that add content past it are
  // refused; deletes always go through, so a full canvas can be thinned.
  docBytes: number;
  // How far a socket may fall behind on what the server sends it, on top of
  // the last full state it was sent (every socket gets one when it joins).
  // Past it the socket is dropped; y-websocket reconnects and resyncs.
  bufferedBytes: number;
};

export const DEFAULT_LIMITS: CanvasLimits = {
  writerMessageBytes: 2 * MiB,
  readerMessageBytes: 256 * KiB,
  messagesPerSecond: 300,
  messageBurst: 600,
  bytesPerSecond: 1 * MiB,
  byteBurst: 8 * MiB,
  syncRequestsPerMinute: 12,
  syncRequestBurst: 4,
  docBytes: 16 * MiB,
  bufferedBytes: 8 * MiB,
};

// Transaction origins for changes the server makes itself.
const LOAD_ORIGIN = Symbol("canvas-load");
const SERVER_ORIGIN = Symbol("canvas-server");

// Hard ceiling on one frame, enforced by the socket before any of the checks
// in CanvasLimits run. Kept well above `writerMessageBytes` so an oversized
// edit is refused with CLOSE_EDIT_REFUSED, which y-websocket doesn't retry,
// rather than with 1009, which it does, resending the same frame forever.
const MAX_PAYLOAD_BYTES = 16 * MiB;

// Top-level types a client may create: the ones canvas-doc.ts defines.
const DOC_ROOTS = new Set([ELEMENTS_KEY]);

// The doc's exact size is re-measured at most this often while it's near the
// ceiling, since measuring encodes the whole doc.
const MEASURE_INTERVAL_MS = 1000;

class Bucket {
  private tokens: number;
  private at = Date.now();

  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }

  take(n: number): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.perSecond);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

type Conn = {
  access: CanvasAccess;
  userId: string | null;
  // Awareness client ids this socket announced, cleared when it leaves so its
  // cursor doesn't linger for everyone else.
  clientIds: Set<number>;
  alive: boolean;
  // The upgrade request, kept so a permission change can run `authorize` again
  // with the same cookie.
  req: IncomingMessage;
  // Who this socket appears as in presence, set from `authorize`. Null for
  // read access.
  user: PresenceUser | null;
  // Bumped for each re-authorization, so a slow answer can't land over a newer
  // one.
  checks: number;
  messages: Bucket;
  bytes: Bucket;
  syncRequests: Bucket;
  // Set once one of its edits is refused. Nothing it sends afterwards is read:
  // its later updates build on the refused one.
  refused: boolean;
  // Size of the last full state sent to it, which it may still be reading on
  // top of `bufferedBytes`.
  slack: number;
};

type RoomOptions = {
  channelId: number;
  store: CanvasStore;
  debounceMs: number;
  maxWaitMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  limits: CanvasLimits;
  onGone: (room: Room) => void;
  // After a retried save goes through, so an idle room can be released.
  onSaved: (room: Room) => void;
};

class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly conns = new Map<WebSocket, Conn>();

  readonly channelId: number;

  private dirty = false;
  private firstDirtyAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Saves run one at a time, in order, so an older state can never land after
  // a newer one. Each resolves to whether it reached the store.
  private saving: Promise<boolean> = Promise.resolve(true);
  // Saves failed in a row. While above zero, the retry timer owns the next save.
  private failures = 0;
  // Bumped on every change, so the encoded state below is reused until the
  // doc moves on.
  private version = 0;
  private encoded: { version: number; message: Uint8Array; update: Uint8Array } | null = null;
  // The doc's size when it was last encoded, and the bytes of updates applied
  // since: together an upper bound on its size now, since overwritten values
  // shrink to nothing.
  private measured = 0;
  private grown = 0;
  private measuredAt = 0;
  closed = false;
  // Why it closed, as the close code sent to its sockets.
  closeCode = 0;
  // Settles once the saved doc is loaded and pruned. Set by getRoom.
  ready: Promise<void> = Promise.resolve();
  anchors: ThreadAnchors | null = null;

  constructor(private readonly opts: RoomOptions) {
    this.channelId = opts.channelId;
    // The server holds no presence of its own.
    this.awareness.setLocalState(null);

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.changed();
      // A writer's bytes were counted when they arrived (applyClientUpdate).
      if (!this.conns.has(origin as WebSocket)) this.grown += update.length;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
      if (origin !== LOAD_ORIGIN) this.markDirty();
    });

    this.awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        // Look the socket up rather than test `instanceof WebSocket`: under Bun
        // the sockets aren't instances of the ws package's class.
        const conn = this.conns.get(origin as WebSocket);
        if (conn) {
          for (const id of added) conn.clientIds.add(id);
          for (const id of removed) conn.clientIds.delete(id);
        }
        const changed = [...added, ...updated, ...removed];
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.broadcast(encoding.toUint8Array(encoder));
      },
    );
  }

  get limits(): CanvasLimits {
    return this.opts.limits;
  }

  // Send to one socket, unless it has stopped reading: then drop it, so what
  // it hasn't read stops piling up in memory. Everything sent to a socket in
  // the room, broadcasts included, goes through here.
  send(ws: WebSocket, message: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const slack = this.conns.get(ws)?.slack ?? 0;
    if (ws.bufferedAmount > this.limits.bufferedBytes + slack) {
      ws.terminate();
      return;
    }
    ws.send(message, (err) => {
      if (err) ws.terminate();
    });
  }

  broadcast(message: Uint8Array): void {
    for (const ws of this.conns.keys()) this.send(ws, message);
  }

  changed(): void {
    this.version++;
    this.encoded = null;
  }

  // The whole doc as one update, encoded once per version of the doc and
  // shared by the save and by every socket that asks for it.
  private encode(): { message: Uint8Array; update: Uint8Array } {
    if (this.encoded?.version !== this.version) {
      const update = Y.encodeStateAsUpdate(this.doc);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep2);
      encoding.writeVarUint8Array(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.encoded = {
        version: this.version,
        message,
        update: message.subarray(message.length - update.length),
      };
      this.measured = update.length;
      this.grown = 0;
      this.measuredAt = Date.now();
    }
    return this.encoded;
  }

  // The reply to a sync step 1: the whole doc, whatever the client said it
  // has. Applying state a client already holds is a no-op, and encoding a diff
  // per request is what let readers stall the server.
  syncReply(): Uint8Array {
    return this.encode().message;
  }

  // Whether an update of `bytes` that adds content fits under the ceiling.
  admits(bytes: number): boolean {
    const ceiling = this.limits.docBytes;
    if (this.measured + this.grown + bytes <= ceiling) return true;
    if (Date.now() - this.measuredAt >= MEASURE_INTERVAL_MS) this.encode();
    return this.measured + this.grown + bytes <= ceiling;
  }

  // Bytes of a writer's update, counted before it's applied: an update whose
  // dependencies haven't arrived is held by Yjs without changing the doc.
  count(bytes: number): void {
    this.grown += bytes;
    this.changed();
  }

  sendEvent(event: ChannelEvent): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_CHANNEL_EVENT);
    encoding.writeVarString(encoder, JSON.stringify(event));
    this.broadcast(encoding.toUint8Array(encoder));
  }

  private markDirty(): void {
    if (this.closed) return;
    const now = Date.now();
    this.dirty = true;
    this.firstDirtyAt ??= now;
    // A save is failing: the retry timer, or the save in flight, picks this up.
    if (this.failures > 0) return;
    if (this.timer) clearTimeout(this.timer);
    const { debounceMs, maxWaitMs } = this.opts;
    const wait = Math.min(debounceMs, maxWaitMs - (now - this.firstDirtyAt));
    this.timer = setTimeout(() => void this.flush(), Math.max(0, wait));
  }

  // Try a failed save again later, waiting longer after each failure.
  private scheduleRetry(): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    const { retryBaseMs, retryMaxMs } = this.opts;
    const wait = Math.min(retryBaseMs * 2 ** (this.failures - 1), retryMaxMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().then((ok) => {
        if (ok) this.opts.onSaved(this);
      });
    }, wait);
  }

  // Whether some change hasn't reached the store yet.
  get unsaved(): boolean {
    return this.dirty;
  }

  // Save now if anything changed since the last save. Resolves once this save
  // (and any before it) has finished: true if the doc as it stood is stored,
  // false if the save failed. A failed save keeps the change and retries on a
  // backoff until one succeeds.
  flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty && !this.closed) {
      this.dirty = false;
      this.firstDirtyAt = null;
      const state = this.encode().update;
      const hasElements = elementsOf(this.doc).size > 0;
      this.saving = this.saving.then(async () => {
        try {
          const result = await this.opts.store.save(this.channelId, state, hasElements);
          this.failures = 0;
          if (result === "gone") this.opts.onGone(this);
          // Edits that came in while a retry was pending weren't scheduled.
          else if (this.dirty) this.markDirty();
          return true;
        } catch (err) {
          console.error(`[realtime] saving canvas ${this.channelId} failed`, err);
          this.failures++;
          this.dirty = true;
          this.firstDirtyAt ??= Date.now();
          this.scheduleRetry();
          return false;
        }
      });
    }
    return this.saving;
  }

  // Close every socket and stop saving. `code` tells clients why.
  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCode = code;
    if (this.timer) clearTimeout(this.timer);
    void this.anchors?.detach();
    for (const ws of this.conns.keys()) ws.close(code, reason);
    this.conns.clear();
    this.awareness.destroy();
    this.doc.destroy();
  }
}

// For a socket that isn't in a room yet.
function send(ws: WebSocket, message: Uint8Array): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(message, (err) => {
    if (err) ws.terminate();
  });
}

function reject(socket: Duplex, status: number, text: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function channelIdFromPath(url: string | undefined): number | null {
  if (!url) return null;
  const path = url.split("?")[0];
  if (!path.startsWith(CANVAS_PATH)) return null;
  const rest = path.slice(CANVAS_PATH.length);
  if (!/^\d+$/.test(rest)) return null;
  const id = Number(rest);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Whether an update creates a top-level type the doc doesn't define, and
// whether it adds content at all (an update can carry deletions only). A new
// top-level type only ever shows up as an item naming its parent by string:
// items placed next to an existing one take that one's parent.
function inspectUpdate(update: Uint8Array): { foreignRoot: boolean; adds: boolean } {
  const { structs } = Y.decodeUpdate(update);
  let foreignRoot = false;
  for (const struct of structs) {
    if (!(struct instanceof Y.Item)) continue;
    if (typeof struct.parent === "string" && !DOC_ROOTS.has(struct.parent)) foreignRoot = true;
  }
  return { foreignRoot, adds: structs.some((s) => s instanceof Y.Item) };
}

export function createCanvasServer(options: CanvasServerOptions) {
  const {
    store,
    authorize,
    threads,
    debounceMs = 1000,
    maxWaitMs = 10_000,
    pingIntervalMs = 30_000,
    retryBaseMs = 1000,
    retryMaxMs = 60_000,
  } = options;
  const limits: CanvasLimits = { ...DEFAULT_LIMITS, ...options.limits };

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const rooms = new Map<number, Room>();

  // Version history (canvas-history.ts): who sent each accepted edit, and rooms
  // held open while `withDoc` works on them.
  const editListeners = new Set<(channelId: number, userId: string | null) => void>();
  const held = new Map<Room, number>();

  function dropRoom(room: Room, code: number, reason: string): void {
    // A replacement may already be loading under the same id; leave it be.
    if (rooms.get(room.channelId) === room) rooms.delete(room.channelId);
    room.close(code, reason);
  }

  // Save and unload a room once its last socket has gone. A room whose save
  // fails stays loaded, edits and all, and its retry timer calls back here once
  // a save goes through.
  function releaseIfIdle(room: Room): void {
    if (room.conns.size > 0 || room.closed || held.has(room)) return;
    void room.flush().then((saved) => {
      if (!saved || room.unsaved) return;
      // Someone may have joined while the save ran.
      if (room.conns.size === 0 && !room.closed && !held.has(room)) dropRoom(room, 1000, "idle");
    });
  }

  // Block removals for channels with no room loaded, waiting to be pruned from
  // the stored doc, and the prune running for each channel. A room loading for
  // a channel waits for its prune, so the two never write over each other.
  const pruneIds = new Map<number, Set<number>>();
  const prunes = new Map<number, Promise<void>>();

  // Drop a removed block's elements from a canvas nobody has open, so the
  // stored `has_elements` stays true to the doc. Removals that arrive together
  // (a bulk delete or move) share one load and save.
  function pruneStored(channelId: number, columnId: number): void {
    const waiting = pruneIds.get(channelId);
    if (waiting) {
      waiting.add(columnId);
      return;
    }
    const ids = new Set([columnId]);
    pruneIds.set(channelId, ids);
    const job = (prunes.get(channelId) ?? Promise.resolve())
      .then(async () => {
        pruneIds.delete(channelId);
        // A room opened meanwhile prunes on its own load.
        if (rooms.has(channelId)) return;
        const saved = await store.load(channelId);
        if (!saved) return;
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, saved);
          if (removeBlockElements(doc, (id) => !ids.has(id), null) === 0) return;
          await store.save(channelId, Y.encodeStateAsUpdate(doc), elementsOf(doc).size > 0);
        } finally {
          doc.destroy();
        }
      })
      .catch((err) => console.error(`[realtime] pruning canvas ${channelId} failed`, err))
      .finally(() => {
        if (prunes.get(channelId) === job) prunes.delete(channelId);
      });
    prunes.set(channelId, job);
  }

  function getRoom(channelId: number): Room {
    const existing = rooms.get(channelId);
    if (existing) return existing;
    const room = new Room({
      channelId,
      store,
      debounceMs,
      maxWaitMs,
      retryBaseMs,
      retryMaxMs,
      limits,
      onGone: (r) => dropRoom(r, CLOSE_CHANNEL_GONE, "channel deleted"),
      onSaved: (r) => releaseIfIdle(r),
    });
    // Writers' updates arrive with their socket as the transaction origin.
    // Looked up rather than checked with instanceof: under Bun, sockets from
    // WebSocketServer aren't instances of the `ws` package's WebSocket.
    room.doc.on("update", (_update: Uint8Array, origin: unknown) => {
      const conn = editListeners.size > 0 ? room.conns.get(origin as WebSocket) : undefined;
      if (!conn) return;
      for (const listener of editListeners) listener(channelId, conn.userId);
    });
    room.ready = (async () => {
      await prunes.get(channelId);
      const saved = await store.load(channelId);
      if (saved) Y.applyUpdate(room.doc, saved, LOAD_ORIGIN);
      // Before the prune, so a pruned block frees its threads where it was. A
      // failure here costs thread anchoring, not the canvas.
      if (threads) {
        room.anchors = await attachThreadAnchors({
          channelId,
          doc: room.doc,
          store: threads,
          send: (event) => room.sendEvent(event),
        }).catch((err) => {
          console.error(`[realtime] loading threads for canvas ${channelId} failed`, err);
          return null;
        });
      }
      // Blocks deleted or moved away while nobody had the canvas open still
      // have elements in the saved doc. Drop them now; the removal saves like
      // any other change.
      const live = await store.columnIds(channelId);
      removeBlockElements(room.doc, (id) => live.has(id), SERVER_ORIGIN);
    })();
    // A failed load mustn't poison the id for the next connection, nor leave
    // the awareness timer, the doc and its thread observers behind.
    room.ready.catch(() => {
      if (rooms.get(channelId) === room) rooms.delete(channelId);
      room.close(1011, "load failed");
    });
    rooms.set(channelId, room);
    return room;
  }

  // Refuse a writer's edit for good: tell it why, then close with a code
  // y-websocket won't retry, since a reconnect would send the same edit again.
  // `room` is null for a socket still waiting for its room to load.
  function refuse(
    room: Room | null,
    ws: WebSocket,
    conn: Conn,
    reason: EditRefusedEvent["reason"],
  ): void {
    conn.refused = true;
    const event = encodeChannelEvent({ type: "edit.refused", reason });
    if (room) room.send(ws, event);
    else send(ws, event);
    ws.close(CLOSE_EDIT_REFUSED, `edit refused: ${reason}`);
  }

  // A sync step 2 or update from a writer.
  function applyClientUpdate(room: Room, ws: WebSocket, conn: Conn, update: Uint8Array): void {
    const { foreignRoot, adds } = inspectUpdate(update);
    if (foreignRoot) return refuse(room, ws, conn, "invalid");
    if (adds && !room.admits(update.length)) return refuse(room, ws, conn, "doc-full");
    room.count(update.length);
    Y.applyUpdate(room.doc, update, ws);
  }

  function handleMessage(room: Room, ws: WebSocket, conn: Conn, data: Uint8Array): void {
    if (conn.refused) return;
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        const step = decoding.readVarUint(decoder);
        if (step === syncProtocol.messageYjsSyncStep1) {
          // Over budget, the request is dropped: a client asks once per
          // connection and gets every update anyway.
          if (conn.syncRequests.take(1)) {
            const reply = room.syncReply();
            room.send(ws, reply);
            conn.slack = reply.length;
          }
        } else if (
          conn.access === "write" &&
          (step === syncProtocol.messageYjsSyncStep2 || step === syncProtocol.messageYjsUpdate)
        ) {
          applyClientUpdate(room, ws, conn, decoding.readVarUint8Array(decoder));
        }
        // Read-only: anything carrying an update is dropped.
        break;
      }
      case MESSAGE_AWARENESS: {
        if (conn.access === "write" && conn.user) {
          // The editor's identity replaces whatever it sent, and it can only
          // touch the client ids it announced.
          const update = stampAwarenessUpdate(
            decoding.readVarUint8Array(decoder),
            conn.user,
            (id) => claimClientId(room.conns, ws, id),
          );
          if (update) awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
        }
        break;
      }
      case MESSAGE_QUERY_AWARENESS: {
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(room.awareness, [
            ...room.awareness.getStates().keys(),
          ]),
        );
        room.send(ws, encoding.toUint8Array(encoder));
        break;
      }
      default:
        // Unknown types are ignored, like y-websocket's own server does.
        break;
    }
  }

  async function onConnection(
    ws: WebSocket,
    req: IncomingMessage,
    channelId: number,
    auth: Authorization,
    // accessEpoch when `authorize` was asked.
    epoch: number,
  ) {
    const conn: Conn = {
      access: auth.access,
      userId: auth.userId,
      clientIds: new Set(),
      alive: true,
      req,
      user: presenceFor(auth),
      checks: 0,
      messages: new Bucket(limits.messagesPerSecond, limits.messageBurst),
      bytes: new Bucket(limits.bytesPerSecond, limits.byteBurst),
      syncRequests: new Bucket(limits.syncRequestsPerMinute / 60, limits.syncRequestBurst),
      refused: false,
      slack: 0,
    };
    // Messages can arrive while the room loads. Hold them until it's ready
    // rather than dropping the client's first sync step.
    const pending: Uint8Array[] = [];
    let room: Room | null = null;

    ws.on("message", (raw: RawData) => {
      if (conn.refused || ws.readyState !== WebSocket.OPEN) return;
      const data = toBytes(raw);
      // Checked on arrival, before anything is queued or decoded.
      const cap = conn.access === "write" ? limits.writerMessageBytes : limits.readerMessageBytes;
      if (data.length > cap) {
        refuse(room, ws, conn, "too-large");
        return;
      }
      if (!conn.messages.take(1) || !conn.bytes.take(data.length)) {
        ws.close(1013, "slow down");
        return;
      }
      if (!room) {
        pending.push(data);
        return;
      }
      try {
        handleMessage(room, ws, conn, data);
      } catch (err) {
        console.error(`[realtime] bad message on canvas ${channelId}`, err);
        ws.close(1003, "bad message");
      }
    });
    ws.on("pong", () => {
      conn.alive = true;
    });
    ws.on("close", () => {
      if (!room || !room.conns.delete(ws)) return;
      awarenessProtocol.removeAwarenessStates(room.awareness, [...conn.clientIds], null);
      releaseIfIdle(room);
    });

    let joining = getRoom(channelId);
    for (;;) {
      try {
        await joining.ready;
      } catch (err) {
        console.error(`[realtime] loading canvas ${channelId} failed`, err);
        ws.close(1011, "load failed");
        return;
      }
      if (!joining.closed) break;
      // The room this socket found was unloading because its last client had
      // just left. Load it afresh rather than turning the newcomer away.
      if (joining.closeCode === 1000) {
        joining = getRoom(channelId);
        continue;
      }
      // Deleted channel or shutdown: pass the same code on.
      ws.close(joining.closeCode, "canvas closed");
      return;
    }
    // The client left while the room loaded.
    if (ws.readyState !== WebSocket.OPEN) {
      releaseIfIdle(joining);
      return;
    }
    room = joining;
    room.conns.set(ws, conn);

    // Tell the client what it may do before anything else arrives.
    room.send(ws, encodeChannelEvent({ type: "session", access: conn.access, user: conn.user }));

    // Ask for whatever the client has that the server doesn't (offline edits).
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    room.send(ws, encoding.toUint8Array(encoder));

    const states = room.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      room.send(ws, encoding.toUint8Array(aw));
    }

    for (const data of pending.splice(0)) {
      try {
        handleMessage(room, ws, conn, data);
      } catch (err) {
        console.error(`[realtime] bad message on canvas ${channelId}`, err);
        ws.close(1003, "bad message");
        return;
      }
    }

    // A permission change landed between `authorize` and joining, which no
    // re-check could reach while the socket wasn't in the room. Check again.
    if (epoch !== accessEpoch) void reauthorize(room, ws, conn);
  }

  // Bumped by every access event, so a socket can tell whether one arrived
  // while it was being authorized.
  let accessEpoch = 0;

  // Run `authorize` again for an open socket after a permission change, and
  // apply the answer: close it if the viewer can't read the channel any more,
  // otherwise switch it to whatever access they have now.
  async function reauthorize(room: Room, ws: WebSocket, conn: Conn): Promise<void> {
    const check = ++conn.checks;
    let next: Authorization | null;
    try {
      next = await authorize(conn.req, room.channelId);
    } catch (err) {
      console.error(`[realtime] re-authorizing on canvas ${room.channelId} failed`, err);
      // Without an answer the old access can't be trusted. 1011 is retried, and
      // the reconnect authorizes from scratch.
      if (check === conn.checks && room.conns.has(ws)) ws.close(1011, "authorization failed");
      return;
    }
    if (check !== conn.checks || room.closed || !room.conns.has(ws)) return;
    if (!next) {
      ws.close(CLOSE_ACCESS_REVOKED, "access revoked");
      return;
    }
    const was = conn.access;
    conn.access = next.access;
    conn.userId = next.userId;
    conn.user = presenceFor(next);
    if (was === "write" && next.access === "read") {
      // From here the read-only filters drop its updates and awareness. Take
      // its cursor off everyone's screen now rather than at its next message.
      awarenessProtocol.removeAwarenessStates(room.awareness, [...conn.clientIds], null);
      conn.clientIds.clear();
    }
    if (was !== next.access) {
      room.send(ws, encodeChannelEvent({ type: "session", access: conn.access, user: conn.user }));
    }
  }

  // Drop sockets that stopped answering pings (a laptop lid closed mid-edit)
  // so their cursors don't hang around.
  const pinger = setInterval(() => {
    for (const room of rooms.values()) {
      for (const [ws, conn] of room.conns) {
        if (!conn.alive) {
          ws.terminate();
          continue;
        }
        conn.alive = false;
        ws.ping();
      }
    }
  }, pingIntervalMs);
  pinger.unref?.();

  return {
    // Take an upgrade if it's for a canvas. Returns false for any other path so
    // the caller can hand it on (Next's dev server has its own HMR socket).
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      const channelId = channelIdFromPath(req.url);
      if (channelId === null) return false;
      const epoch = accessEpoch;
      // A client that hung up while `authorize` ran has nothing left to
      // upgrade, and Bun's handleUpgrade throws on it.
      const upgrade = (then: (ws: WebSocket) => void) => {
        try {
          wss.handleUpgrade(req, socket, head, then);
        } catch {
          socket.destroy();
        }
      };
      authorize(req, channelId).then(
        (auth) => {
          if (!auth) {
            // Refused after the handshake rather than with an HTTP 403, which
            // y-websocket would retry forever. 4403 tells it to stop, and the
            // same code for a missing channel keeps the two indistinguishable.
            upgrade((ws) => ws.close(CLOSE_ACCESS_REVOKED, "forbidden"));
            return;
          }
          upgrade((ws) => void onConnection(ws, req, channelId, auth, epoch));
        },
        (err) => {
          console.error(`[realtime] authorizing canvas ${channelId} failed`, err);
          reject(socket, 500, "Internal Server Error");
        },
      );
      return true;
    },

    // React to a data-layer event (lib/realtime/events.ts). Only rooms already
    // open or loading care; a closed canvas prunes on its next load.
    handleEvent(event: RealtimeEvent): void {
      if (isAccessEvent(event)) {
        accessEpoch++;
        for (const room of rooms.values()) {
          if (room.closed) continue;
          for (const [ws, conn] of room.conns) {
            if (affects(event, room.channelId, conn.userId)) void reauthorize(room, ws, conn);
          }
        }
        return;
      }
      const room = rooms.get(event.channelId);
      if (!room) {
        if (event.type === "block.removed") pruneStored(event.channelId, event.columnId);
        return;
      }
      room.ready.then(
        () => {
          if (room.closed) return;
          if (isThreadEvent(event)) {
            room.sendEvent(toThreadChannelEvent(event));
            room.anchors?.handle(event);
            return;
          }
          switch (event.type) {
            case "block.added":
              room.sendEvent({ type: "block.added", columnId: event.columnId });
              break;
            case "block.removed":
              removeBlockElements(room.doc, (id) => id !== event.columnId, SERVER_ORIGIN);
              room.sendEvent({ type: "block.removed", columnId: event.columnId });
              break;
            case "channel.deleted":
              dropRoom(room, CLOSE_CHANNEL_GONE, "channel deleted");
              break;
          }
        },
        () => {},
      );
    },

    // Save every open canvas, then close its sockets with 1012 ("service
    // restart") so clients reconnect to the next container. Called on SIGTERM.
    async shutdown(): Promise<void> {
      clearInterval(pinger);
      await Promise.all(
        [...rooms.values()].map(async (room) => {
          try {
            await room.ready;
          } catch {
            return;
          }
          if (!(await room.flush())) {
            console.error(`[realtime] canvas ${room.channelId} closed with unsaved edits`);
          }
          await room.anchors?.detach();
          room.close(1012, "server restarting");
        }),
      );
      rooms.clear();
      await Promise.all(prunes.values());
      wss.close();
    },

    // Version history hooks (canvas-history.ts).
    //
    // `onEdit` hears every update a writer's socket sends.
    onEdit(listener: (channelId: number, userId: string | null) => void): () => void {
      editListeners.add(listener);
      return () => editListeners.delete(listener);
    },

    // Run `fn` on the channel's live doc and save what it changed. An open
    // room's clients get the change like any edit. A closed canvas is loaded
    // into a room for the duration, so a client joining meanwhile sees the
    // change too, and unloaded again once saved. Null when the channel is gone.
    // Throws when the save fails: the change stays live in the room, which
    // keeps retrying the save, but the caller mustn't report it as done.
    async withDoc<R>(channelId: number, fn: (doc: Y.Doc) => R): Promise<R | null> {
      for (;;) {
        const room = getRoom(channelId);
        held.set(room, (held.get(room) ?? 0) + 1);
        try {
          await room.ready;
          // Caught unloading after its last client left: load it afresh.
          if (room.closed && room.closeCode === 1000) continue;
          if (room.closed) return null;
          const result = fn(room.doc);
          const saved = await room.flush();
          if (room.closed) return null;
          if (!saved) throw new Error(`saving canvas ${channelId} failed`);
          return result;
        } finally {
          const holds = held.get(room)! - 1;
          if (holds > 0) held.set(room, holds);
          else held.delete(room);
          releaseIfIdle(room);
        }
      }
    },

    // For tests: how many rooms are loaded.
    roomCount(): number {
      return rooms.size;
    },

    // For tests: how many sockets have joined a room.
    socketCount(): number {
      let n = 0;
      for (const room of rooms.values()) n += room.conns.size;
      return n;
    },
  };
}

export type CanvasServer = ReturnType<typeof createCanvasServer>;

function toBytes(raw: RawData): Uint8Array {
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}
