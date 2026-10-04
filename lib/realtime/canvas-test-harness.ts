// Shared setup for the presence and permission tests: a real canvas server on
// a bare http server, authorizing through the same rule the authorize route
// uses (canvasAuthorization) against the seeded database, and stock
// y-websocket clients.
//
// The route takes the user from the session cookie. Here they come from
// `?user=<id>` instead, and a banned user resolves to signed out, the way
// getSessionUser treats them.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { eq } from "drizzle-orm";
import * as decoding from "lib0/decoding";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { canvasAuthorization } from "@/lib/colosseum/canvas-access";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { createCanvasServer, type Authorization, type CanvasServer } from "./canvas-server";
import { createPgCanvasStore } from "./canvas-store";
import { subscribeRealtime } from "./events";
import { MESSAGE_CHANNEL_EVENT, type ChannelEvent } from "./protocol";

export type Harness = {
  url: string;
  canvas: CanvasServer;
  // Every authorize call, in order, for tests that count re-checks.
  authorizations: { channelId: number; userId: string | null }[];
  // Set to make authorize wait before answering, after it has read the
  // database: a stale answer arriving late.
  delayAuthorizeMs: number;
  // Set to make the next authorize calls throw.
  failAuthorize: boolean;
  close: () => Promise<void>;
};

async function sessionUserId(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [row] = await db.select({ banned: user.banned }).from(user).where(eq(user.id, id));
  return row && !row.banned ? id : null;
}

export async function startHarness(): Promise<Harness> {
  const store = createPgCanvasStore(process.env.DATABASE_URL!);
  const harness = {
    authorizations: [],
    delayAuthorizeMs: 0,
    failAuthorize: false,
  } as unknown as Harness;
  const canvas = createCanvasServer({
    store,
    authorize: async (req, channelId): Promise<Authorization | null> => {
      if (harness.failAuthorize) throw new Error("authorize is down");
      const asked = new URL(req.url!, "http://x").searchParams.get("user") || null;
      const userId = await sessionUserId(asked);
      harness.authorizations.push({ channelId, userId: asked });
      const auth = await canvasAuthorization(channelId, userId);
      if (harness.delayAuthorizeMs) {
        await new Promise((r) => setTimeout(r, harness.delayAuthorizeMs));
      }
      return auth;
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
  harness.url = `ws://127.0.0.1:${port}/realtime/canvas`;
  harness.canvas = canvas;
  harness.close = async () => {
    unsubscribe();
    await canvas.shutdown();
    await store.end();
    server.close();
  };
  return harness;
}

export type Client = {
  doc: Y.Doc;
  provider: WebsocketProvider;
  // Channel events (type 100) in arrival order.
  events: ChannelEvent[];
  // Close codes the server sent, in order.
  closes: number[];
};

const clients: Client[] = [];

// A y-websocket client signed in as `userId` (null for signed out).
export function connectAs(
  harness: Harness,
  channelId: number,
  userId: string | null,
  doc = new Y.Doc(),
): Client {
  const provider = new WebsocketProvider(harness.url, String(channelId), doc, {
    params: { user: userId ?? "" },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    // Providers in one process would otherwise sync over BroadcastChannel and
    // skip the server entirely.
    disableBc: true,
  });
  const client: Client = { doc, provider, events: [], closes: [] };
  provider.messageHandlers[MESSAGE_CHANNEL_EVENT] = (_encoder, decoder) => {
    client.events.push(JSON.parse(decoding.readVarString(decoder)) as ChannelEvent);
  };
  provider.on("connection-close", (event) => {
    if (event) client.closes.push(event.code);
  });
  clients.push(client);
  return client;
}

export function destroyClients(): void {
  for (const c of clients.splice(0)) c.provider.destroy();
}

export function synced(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return new Promise((resolve) => provider.once("sync", () => resolve()));
}

export async function waitFor(check: () => boolean, what: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The last `session` event a client got, if any.
export function lastSession(client: Client) {
  return client.events.findLast(
    (e): e is Extract<ChannelEvent, { type: "session" }> => e.type === "session",
  );
}
