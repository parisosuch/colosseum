// A local forward proxy that the screenshot capture's headless Chromium is
// pointed at, so every request the page makes (the navigation, each redirect,
// iframes, images, scripts, fetch/XHR, WebSockets, workers) gets the same check
// as guardedFetch: resolve the host, refuse anything that isn't public, then
// connect to the address that was checked.
//
// Checking the URL before `page.goto` alone wouldn't be enough. A public page
// can embed `<iframe src="http://169.254.169.254/…">` and the screenshot would
// show whatever the metadata service returned, and Chromium does its own DNS,
// so a host checked here could resolve somewhere else by the time the browser
// connects. With a proxy, Chromium never resolves destination hosts itself.
//
// HTTPS and WebSockets arrive as CONNECT tunnels (the proxy sees host:port, the
// TLS stays end to end); plain HTTP arrives as absolute-form requests and is
// forwarded one request at a time, since Chromium reuses a proxy connection
// across hosts.
//
// Bound to 127.0.0.1 on an ephemeral port for the life of one capture.

import http from "node:http";
import net from "node:net";

import {
  type AddressPolicy,
  type Resolver,
  pinnedLookup,
  resolvePublicHost,
} from "./guarded-fetch";

export type GuardedProxy = {
  // e.g. "http://127.0.0.1:41234", for Chromium's --proxy-server.
  url: string;
  close(): Promise<void>;
};

// Hop-by-hop headers (RFC 9110) plus the proxy's own, which mustn't be
// forwarded upstream.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function refuse(socket: net.Socket, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export async function startGuardedProxy(
  opts: { resolver?: Resolver; policy?: AddressPolicy } = {},
): Promise<GuardedProxy> {
  const sockets = new Set<net.Socket>();

  const server = http.createServer(async (req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== "http:") {
      res.writeHead(400).end();
      return;
    }
    let addresses;
    try {
      addresses = await resolvePublicHost(target.hostname, opts);
    } catch {
      res.writeHead(403).end();
      return;
    }
    const headers: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(key) && value !== undefined) headers[key] = value;
    }
    const upstream = http.request(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers,
        agent: false,
        lookup: pinnedLookup(addresses),
      },
      (up) => {
        const out: http.OutgoingHttpHeaders = {};
        for (const [key, value] of Object.entries(up.headers)) {
          if (!HOP_BY_HOP.has(key) && value !== undefined) out[key] = value;
        }
        res.writeHead(up.statusCode ?? 502, out);
        up.pipe(res);
        up.on("error", () => res.destroy());
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
    req.pipe(upstream);
  });

  server.on("connect", async (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => client.destroy());
    let target: URL;
    try {
      target = new URL(`http://${req.url}`);
    } catch {
      refuse(client, "400 Bad Request");
      return;
    }
    let addresses;
    try {
      addresses = await resolvePublicHost(target.hostname, opts);
    } catch {
      refuse(client, "403 Forbidden");
      return;
    }
    const upstream = net.connect({
      host: addresses[0].address,
      port: Number(target.port) || 443,
    });
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => {
      if (!client.destroyed) refuse(client, "502 Bad Gateway");
    });
    client.on("close", () => upstream.destroy());
  });

  // A WebSocket upgrade sent as a plain absolute-form request. Chromium tunnels
  // WebSockets with CONNECT, so nothing legitimate lands here.
  server.on("upgrade", (_req: http.IncomingMessage, socket: net.Socket) => {
    refuse(socket, "403 Forbidden");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
