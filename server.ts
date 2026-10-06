// The app's server: Next's request handler plus the realtime sockets, on one
// port. `bun run dev` and `bun run start` both run this file, so self-hosters
// keep a single port (3000) and whatever proxy already sits in front of it, as
// long as that proxy passes WebSocket upgrades.

import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";

import next from "next";

import { createCanvasHistory } from "./lib/realtime/canvas-history";
import { setCanvasHistory } from "./lib/realtime/canvas-history-registry";
import { createPgVersionStore } from "./lib/realtime/canvas-history-store";
import { createRestoreWorker } from "./lib/realtime/canvas-restore-pool";
import { startRetention } from "./lib/realtime/canvas-retention";
import { createCanvasServer, type Authorization } from "./lib/realtime/canvas-server";
import { createPgCanvasStore } from "./lib/realtime/canvas-store";
import { createPgThreadStore } from "./lib/realtime/canvas-thread-store";
import { subscribeRealtime } from "./lib/realtime/events";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;

// Bun has already loaded .env / .env.local into process.env by now, which is
// where the canvas store's DATABASE_URL comes from in local dev. In the
// container it comes from compose.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

// Next handles upgrades (dev HMR, and rewrites to WebSocket backends) through a
// listener it attaches, on the first request, to the server it's given or the
// one it finds through that request's socket. In production that listener
// closes every socket it doesn't recognise, /realtime included, and
// `getUpgradeHandler()` is an empty function in Next 15. So Next gets a relay
// emitter as its server, and the upgrade handler below re-emits on it only what
// the canvas doesn't take.
const nextUpgrades = new EventEmitter();

const app = next({
  dev,
  port,
  hostname: "localhost",
  turbopack: dev,
  httpServer: nextUpgrades as unknown as Server,
});
const handle = app.getRequestHandler();
await app.prepare();

// The browser sends cookies on a WebSocket handshake from any page, so a
// socket opened by another site would arrive signed in as the viewer. Only
// accept upgrades whose Origin is this app: the public URL Better Auth is
// configured with, or the Host the request came in on.
const trustedOrigins = new Set<string>();
if (process.env.BETTER_AUTH_URL) trustedOrigins.add(new URL(process.env.BETTER_AUTH_URL).origin);

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  // Non-browser clients send no Origin; they can't ride a viewer's cookies.
  if (!origin) return true;
  if (trustedOrigins.has(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Who may open a channel's canvas is the channel page's rule, and that lives in
// the data layer, which only runs inside Next. Ask the app over loopback with
// the viewer's cookie rather than duplicating it here.
async function authorize(req: IncomingMessage, channelId: number): Promise<Authorization | null> {
  if (!sameOrigin(req)) return null;
  // A share-link socket names its token in the query string; the app decides
  // what it grants and the cookie plays no part.
  const share = new URL(req.url ?? "", "http://localhost").searchParams.get("share");
  const query = `channel=${channelId}${share ? `&share=${encodeURIComponent(share)}` : ""}`;
  const res = await fetch(`http://127.0.0.1:${port}/api/realtime/authorize?${query}`, {
    headers: { cookie: share ? "" : (req.headers.cookie ?? "") },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`authorize returned ${res.status}`);
  return (await res.json()) as Authorization;
}

const store = createPgCanvasStore(databaseUrl);
const threads = createPgThreadStore(databaseUrl);
const canvas = createCanvasServer({ store, authorize, threads });
subscribeRealtime((event) => canvas.handleEvent(event));

// Canvas version history. The server writes versions as editing sessions go
// quiet, the server actions reach it through the registry, and old automatic
// versions are thinned on a timer here, so self-hosters need no scheduler.
// Restores are computed on a worker thread so a heavy one doesn't stall every
// other room.
const versionStore = createPgVersionStore(databaseUrl);
const restoreWorker = createRestoreWorker();
const history = createCanvasHistory({
  versions: versionStore,
  canvases: store,
  docs: canvas,
  computeRevert: restoreWorker.compute,
});
canvas.onEdit((channelId, userId) => history.recordEdit(channelId, userId));
setCanvasHistory(history);
const retention = startRetention(versionStore);

const server = createServer((req, res) => void handle(req, res));
server.on("upgrade", (req, socket, head) => {
  if (canvas.handleUpgrade(req, socket, head)) return;
  // No listener yet means Next hasn't served a request, so nothing of its
  // could be asking for a socket.
  if (!nextUpgrades.emit("upgrade", req, socket, head)) socket.destroy();
});

server.listen(port, () => {
  console.log(`> Ready on http://localhost:${port} (${dev ? "development" : "production"})`);
});

// `docker compose up -d --build` restarts the container under open canvases.
// Save them before exiting, and close their sockets with "service restart" so
// clients reconnect to the new container.
let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`> ${signal}: saving open canvases`);
  server.close();
  try {
    retention.stop();
    await history.shutdown();
    restoreWorker.terminate();
    await canvas.shutdown();
    await versionStore.end();
    await store.end();
    await threads.end();
  } catch (err) {
    console.error("[realtime] shutdown failed", err);
  }
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
