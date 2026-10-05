import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import net from "node:net";

import { type AddressPolicy, blockedAddressReason, type Resolver } from "./guarded-fetch";
import { type GuardedProxy, startGuardedProxy } from "./guarded-proxy";

// Speak raw HTTP to the proxy the way Chromium does, and return everything it
// sent back before closing (or the first chunk, for a tunnel that stays open).
function exchange(proxyUrl: string, request: string, opts: { firstChunk?: boolean } = {}) {
  const { hostname, port } = new URL(proxyUrl);
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(Number(port), hostname, () => socket.write(request));
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (opts.firstChunk) {
        socket.destroy();
        resolve(data);
      }
    });
    socket.on("end", () => resolve(data));
    socket.on("close", () => resolve(data));
    socket.on("error", reject);
  });
}

describe("guarded proxy", () => {
  let upstream: ReturnType<typeof Bun.serve>;
  let proxy: GuardedProxy;
  let resolveCalls = 0;
  // A loopback server stands in for a public host, as in guarded-fetch.test.ts.
  const policy: AddressPolicy = (a) => (a === "127.0.0.1" ? null : blockedAddressReason(a));
  const resolver: Resolver = async (host) => {
    resolveCalls++;
    if (host === "public.test") return [{ address: "127.0.0.1", family: 4 }];
    if (host === "internal.test") return [{ address: "10.0.0.5", family: 4 }];
    throw new Error(`ENOTFOUND ${host}`);
  };

  beforeAll(async () => {
    upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => new Response(`upstream saw ${new URL(req.url).pathname}`),
    });
    proxy = await startGuardedProxy({ resolver, policy });
  });
  afterAll(async () => {
    await proxy.close();
    upstream.stop(true);
  });

  test("forwards a plain request to a public host, pinned to the checked address", async () => {
    resolveCalls = 0;
    const res = await exchange(
      proxy.url,
      `GET http://public.test:${upstream.port}/page HTTP/1.1\r\nHost: public.test:${upstream.port}\r\nConnection: close\r\n\r\n`,
    );
    expect(res).toStartWith("HTTP/1.1 200");
    expect(res).toContain("upstream saw /page");
    expect(resolveCalls).toBe(1);
  });

  test("tunnels CONNECT to a public host", async () => {
    const res = await exchange(
      proxy.url,
      `CONNECT public.test:${upstream.port} HTTP/1.1\r\nHost: public.test:${upstream.port}\r\n\r\n`,
      { firstChunk: true },
    );
    expect(res).toStartWith("HTTP/1.1 200");
  });

  const refused = [
    [
      "metadata, plain",
      "GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n",
    ],
    ["loopback, plain", "GET http://127.0.0.2:5432/ HTTP/1.1\r\nHost: 127.0.0.2\r\n\r\n"],
    ["private host, plain", "GET http://internal.test/ HTTP/1.1\r\nHost: internal.test\r\n\r\n"],
    ["loopback, CONNECT", "CONNECT 127.0.0.2:443 HTTP/1.1\r\nHost: 127.0.0.2:443\r\n\r\n"],
    ["IPv6 loopback, CONNECT", "CONNECT [::1]:443 HTTP/1.1\r\nHost: [::1]:443\r\n\r\n"],
    ["private network, CONNECT", "CONNECT 10.0.0.1:443 HTTP/1.1\r\nHost: 10.0.0.1:443\r\n\r\n"],
    [
      "private host, CONNECT",
      "CONNECT internal.test:443 HTTP/1.1\r\nHost: internal.test:443\r\n\r\n",
    ],
  ] as const;
  for (const [name, request] of refused) {
    test(`refuses ${name}`, async () => {
      const res = await exchange(proxy.url, request, { firstChunk: true });
      expect(res).toStartWith("HTTP/1.1 403");
    });
  }
});
