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

import { removeBlockElements } from "./canvas-doc";
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
  CLOSE_CHANNEL_GONE,
  MESSAGE_AWARENESS,
  MESSAGE_CHANNEL_EVENT,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  type ChannelEvent,
} from "./protocol";

// `write` is anyone who can contribute to the channel. `read` is anyone else
// who can read it, signed-out viewers included: they receive every update and
// the editors' cursors, and the server drops whatever they send besides a sync
// request, so they can't edit and never show up in presence.
export type CanvasAccess = "read" | "write";

export type Authorization = { access: CanvasAccess; userId: string | null };

export interface CanvasStore {
  load(channelId: number): Promise<Uint8Array | null>;
  // "gone" when the channel no longer exists (its row was deleted under us).
  save(channelId: number, doc: Uint8Array): Promise<"ok" | "gone">;
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
};

// Transaction origins for changes the server makes itself.
const LOAD_ORIGIN = Symbol("canvas-load");
const SERVER_ORIGIN = Symbol("canvas-server");

// Big enough for a canvas's worth of pasted strokes in one update, small enough
// that one client can't make the server buffer something absurd.
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

type Conn = {
  access: CanvasAccess;
  userId: string | null;
  // Awareness client ids this socket announced, cleared when it leaves so its
  // cursor doesn't linger for everyone else.
  clientIds: Set<number>;
  alive: boolean;
};

class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly conns = new Map<WebSocket, Conn>();

  private dirty = false;
  private firstDirtyAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Saves run one at a time, in order, so an older state can never land after
  // a newer one.
  private saving: Promise<void> = Promise.resolve();
  closed = false;
  // Why it closed, as the close code sent to its sockets.
  closeCode = 0;
  // Settles once the saved doc is loaded and pruned. Set by getRoom.
  ready: Promise<void> = Promise.resolve();
  anchors: ThreadAnchors | null = null;

  constructor(
    readonly channelId: number,
    private readonly store: CanvasStore,
    private readonly debounceMs: number,
    private readonly maxWaitMs: number,
    private readonly onGone: (room: Room) => void,
  ) {
    // The server holds no presence of its own.
    this.awareness.setLocalState(null);

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
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
        const conn = origin instanceof WebSocket ? this.conns.get(origin) : undefined;
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

  broadcast(message: Uint8Array): void {
    for (const ws of this.conns.keys()) send(ws, message);
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
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.min(this.debounceMs, this.maxWaitMs - (now - this.firstDirtyAt));
    this.timer = setTimeout(() => void this.flush(), Math.max(0, wait));
  }

  // Save now if anything changed since the last save. Resolves once this save
  // (and any before it) has finished.
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty && !this.closed) {
      this.dirty = false;
      this.firstDirtyAt = null;
      const state = Y.encodeStateAsUpdate(this.doc);
      this.saving = this.saving.then(async () => {
        try {
          const result = await this.store.save(this.channelId, state);
          if (result === "gone") this.onGone(this);
        } catch (err) {
          console.error(`[realtime] saving canvas ${this.channelId} failed`, err);
          // Keep the change pending so the next edit, disconnect or shutdown
          // tries again instead of dropping it.
          this.markDirty();
        }
      });
    }
    return this.saving;
  }

  // Close every socket and stop saving. `code` tells clients why.
  close(code: number, reason: string): void {
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

function send(ws: WebSocket, message: Uint8Array): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(message, (err) => {
    if (err) ws.terminate();
  });
}

function reject(socket: Duplex, status: number, text: string): void {
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

export function createCanvasServer(options: CanvasServerOptions) {
  const {
    store,
    authorize,
    threads,
    debounceMs = 1000,
    maxWaitMs = 10_000,
    pingIntervalMs = 30_000,
  } = options;

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const rooms = new Map<number, Room>();

  function dropRoom(room: Room, code: number, reason: string): void {
    // A replacement may already be loading under the same id; leave it be.
    if (rooms.get(room.channelId) === room) rooms.delete(room.channelId);
    room.close(code, reason);
  }

  // Save and unload a room once its last socket has gone.
  function releaseIfIdle(room: Room): void {
    if (room.conns.size > 0 || room.closed) return;
    void room.flush().then(() => {
      // Someone may have joined while the save ran.
      if (room.conns.size === 0 && !room.closed) dropRoom(room, 1000, "idle");
    });
  }

  function getRoom(channelId: number): Room {
    const existing = rooms.get(channelId);
    if (existing) return existing;
    const room = new Room(channelId, store, debounceMs, maxWaitMs, (r) =>
      dropRoom(r, CLOSE_CHANNEL_GONE, "channel deleted"),
    );
    room.ready = (async () => {
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
    // A failed load mustn't poison the id for the next connection.
    room.ready.catch(() => {
      if (rooms.get(channelId) === room) rooms.delete(channelId);
    });
    rooms.set(channelId, room);
    return room;
  }

  function handleMessage(room: Room, ws: WebSocket, conn: Conn, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        if (conn.access === "write") {
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
        } else if (decoding.readVarUint(decoder) === syncProtocol.messageYjsSyncStep1) {
          // Read-only: answer the request for state, drop anything carrying an
          // update.
          syncProtocol.readSyncStep1(decoder, encoder, room.doc);
        }
        // Only the message type written means there's nothing to reply.
        if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS: {
        if (conn.access === "write") {
          awarenessProtocol.applyAwarenessUpdate(
            room.awareness,
            decoding.readVarUint8Array(decoder),
            ws,
          );
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
        send(ws, encoding.toUint8Array(encoder));
        break;
      }
      default:
        // Unknown types are ignored, like y-websocket's own server does.
        break;
    }
  }

  async function onConnection(ws: WebSocket, channelId: number, auth: Authorization) {
    const conn: Conn = {
      access: auth.access,
      userId: auth.userId,
      clientIds: new Set(),
      alive: true,
    };
    // Messages can arrive while the room loads. Hold them until it's ready
    // rather than dropping the client's first sync step.
    const pending: Uint8Array[] = [];
    let room: Room | null = null;

    ws.on("message", (raw: RawData) => {
      const data = toBytes(raw);
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

    // Ask for whatever the client has that the server doesn't (offline edits).
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    send(ws, encoding.toUint8Array(encoder));

    const states = room.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      send(ws, encoding.toUint8Array(aw));
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
      authorize(req, channelId).then(
        (auth) => {
          if (!auth) return reject(socket, 403, "Forbidden");
          wss.handleUpgrade(req, socket, head, (ws) => void onConnection(ws, channelId, auth));
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
      const room = rooms.get(event.channelId);
      if (!room) return;
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
          await room.flush();
          await room.anchors?.detach();
          room.close(1012, "server restarting");
        }),
      );
      rooms.clear();
      wss.close();
    },

    // For tests: how many rooms are loaded.
    roomCount(): number {
      return rooms.size;
    },
  };
}

export type CanvasServer = ReturnType<typeof createCanvasServer>;

function toBytes(raw: RawData): Uint8Array {
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}
