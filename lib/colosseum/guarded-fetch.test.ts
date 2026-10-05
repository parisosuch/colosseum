import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import {
  type AddressPolicy,
  assertPublicUrl,
  blockedAddressReason,
  BlockedUrlError,
  guardedFetch,
  type Resolver,
  ResponseTooLargeError,
} from "./guarded-fetch";

describe("blockedAddressReason", () => {
  const blocked: [string, string][] = [
    ["127.0.0.1", "loopback"],
    ["127.8.9.10", "loopback"],
    ["10.0.0.1", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "link-local"],
    ["100.64.0.1", "shared (CGNAT)"],
    ["100.127.255.254", "shared (CGNAT)"],
    ["0.0.0.0", "unspecified"],
    ["224.0.0.1", "multicast or reserved"],
    ["255.255.255.255", "multicast or reserved"],
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["[::1]", "loopback"],
    ["fc00::1", "private (ULA)"],
    ["fd12:3456::1", "private (ULA)"],
    ["fe80::1", "link-local"],
    ["fe80::1%eth0", "link-local"],
    ["ff02::1", "multicast"],
    // IPv4 wrapped in IPv6, in both the dotted and the hex spelling.
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["::ffff:10.0.0.1", "private"],
    ["::ffff:a9fe:a9fe", "link-local"],
    ["::127.0.0.1", "loopback"],
    ["64:ff9b::a00:1", "private"],
    ["2002:a9fe:a9fe::1", "link-local"],
    ["2001:0:4136:e378::1", "reserved"],
    ["fec0::1", "reserved"],
  ];
  for (const [address, reason] of blocked) {
    test(`refuses ${address}`, () => {
      expect(blockedAddressReason(address)).toBe(reason);
    });
  }

  const allowed = [
    "93.184.216.34",
    "8.8.8.8",
    "172.32.0.1",
    "100.128.0.1",
    "169.255.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ];
  for (const address of allowed) {
    test(`allows ${address}`, () => {
      expect(blockedAddressReason(address)).toBeNull();
    });
  }

  test("treats a non-address as blocked", () => {
    expect(blockedAddressReason("example.com")).toBe("invalid");
  });
});

// No real DNS in any of these: hosts under .test resolve through this table.
const records: Record<string, string[]> = {
  "internal.test": ["10.0.0.5"],
  "metadata.test": ["169.254.169.254"],
  "mixed.test": ["93.184.216.34", "192.168.0.10"],
  "v6-loopback.test": ["::1"],
};
const stubResolver: Resolver = async (host) => {
  const found = records[host];
  if (!found) throw new Error(`ENOTFOUND ${host}`);
  return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

const fetchOpts = { timeoutMs: 2_000, maxBytes: 1024, resolver: stubResolver };

describe("guardedFetch refuses private addresses", () => {
  // Literal addresses are checked before any connection, so these never touch
  // the network.
  const literals = [
    ["http://127.0.0.1/", "loopback"],
    ["http://127.0.0.1:5432/", "loopback"],
    ["http://10.0.0.1/", "private"],
    ["http://169.254.169.254/latest/meta-data/", "link-local"],
    ["http://[::1]/", "loopback"],
    ["http://[::ffff:127.0.0.1]/", "loopback"],
    ["http://0.0.0.0/", "unspecified"],
    // Spellings the URL parser normalizes to 127.0.0.1.
    ["http://2130706433/", "loopback"],
    ["http://0x7f.1/", "loopback"],
  ] as const;
  for (const [url, reason] of literals) {
    test(url, async () => {
      const err = await guardedFetch(url, fetchOpts).catch((e) => e);
      expect(err).toBeInstanceOf(BlockedUrlError);
      expect(err.message).toContain(`${reason} address`);
    });
  }

  test("a hostname that resolves to a private address", async () => {
    const err = await guardedFetch("http://internal.test/x", fetchOpts).catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrlError);
    expect(err.message).toBe("Refusing to fetch internal.test: it resolves to a private address.");
  });

  test("a hostname with one public and one private record", async () => {
    const err = await guardedFetch("http://mixed.test/", fetchOpts).catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrlError);
  });

  test("a hostname that resolves to an IPv6 loopback", async () => {
    const err = await guardedFetch("https://v6-loopback.test/", fetchOpts).catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrlError);
  });

  test("localhost, through the system resolver", async () => {
    const err = await guardedFetch("http://localhost/", { timeoutMs: 2_000, maxBytes: 1 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(BlockedUrlError);
    expect(err.message).toContain("loopback");
  });

  for (const url of ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com/"]) {
    test(`non-http scheme ${url.split(":")[0]}`, async () => {
      const err = await guardedFetch(url, fetchOpts).catch((e) => e);
      expect(err).toBeInstanceOf(BlockedUrlError);
      expect(err.message).toContain("only http and https");
    });
  }

  test("assertPublicUrl checks without fetching", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/", fetchOpts)).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
    await expect(assertPublicUrl("http://metadata.test/", fetchOpts)).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
  });
});

// A loopback server stands in for a public host. The test policy lets exactly
// 127.0.0.1 through and applies the real rules to everything else, so a
// redirect from it to any other private address is refused as it would be in
// production.
describe("guardedFetch against a stand-in public host", () => {
  let server: ReturnType<typeof Bun.serve>;
  let base: string;
  let resolveCalls = 0;
  const policy: AddressPolicy = (a) => (a === "127.0.0.1" ? null : blockedAddressReason(a));
  const resolver: Resolver = async (host) => {
    resolveCalls++;
    if (host === "public.test") return [{ address: "127.0.0.1", family: 4 }];
    return stubResolver(host);
  };
  const opts = { timeoutMs: 2_000, maxBytes: 1024, resolver, policy };

  beforeAll(() => {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const to = (location: string) => new Response(null, { status: 302, headers: { location } });
        switch (url.pathname) {
          case "/ok":
            return new Response(`hello ${req.headers.get("host")}`, {
              headers: { "content-type": "text/plain" },
            });
          case "/to-metadata":
            return to("http://169.254.169.254/latest/meta-data/");
          case "/to-loopback-v6":
            return to("http://[::1]:8080/");
          case "/to-private-ip":
            return to("http://10.0.0.1/");
          case "/to-internal-host":
            return to("http://internal.test/admin");
          case "/to-file":
            return to("file:///etc/passwd");
          case "/relative":
            return to("/ok");
          case "/loop":
            return to("/loop");
          case "/big":
            return new Response("x".repeat(4096));
          case "/big-streamed":
            return new Response(
              new ReadableStream({
                start(c) {
                  for (let i = 0; i < 8; i++) c.enqueue(new TextEncoder().encode("x".repeat(512)));
                  c.close();
                },
              }),
            );
          case "/gzip":
            return new Response(new Uint8Array(gzipSync("compressed body")), {
              headers: { "content-encoding": "gzip" },
            });
          case "/stall":
            return new Promise<Response>(() => {});
          case "/404":
            return new Response("nope", { status: 404 });
        }
        return new Response("?", { status: 500 });
      },
    });
    base = `http://public.test:${server.port}`;
  });
  afterAll(() => server.stop(true));

  test("fetches through the pinned address and sends the name as Host", async () => {
    resolveCalls = 0;
    const res = await guardedFetch(`${base}/ok`, opts);
    expect(res.ok).toBe(true);
    expect(res.text()).toBe(`hello public.test:${server.port}`);
    expect(res.headers.get("content-type")).toBe("text/plain");
    // public.test has no real DNS record, so a connection that asked DNS again
    // instead of using the checked address would have failed outright.
    expect(resolveCalls).toBe(1);
  });

  const refusedRedirects = [
    ["/to-metadata", "link-local"],
    ["/to-loopback-v6", "loopback"],
    ["/to-private-ip", "private"],
    ["/to-internal-host", "private"],
  ] as const;
  for (const [path, reason] of refusedRedirects) {
    test(`refuses a redirect ${path}`, async () => {
      const err = await guardedFetch(`${base}${path}`, opts).catch((e) => e);
      expect(err).toBeInstanceOf(BlockedUrlError);
      expect(err.message).toContain(`${reason} address`);
    });
  }

  test("refuses a redirect to a non-http scheme", async () => {
    const err = await guardedFetch(`${base}/to-file`, opts).catch((e) => e);
    expect(err).toBeInstanceOf(BlockedUrlError);
  });

  test("follows a relative redirect and reports the final URL", async () => {
    const res = await guardedFetch(`${base}/relative`, opts);
    expect(res.ok).toBe(true);
    expect(res.url).toBe(`${base}/ok`);
  });

  test("caps the number of redirects", async () => {
    const err = await guardedFetch(`${base}/loop`, { ...opts, maxRedirects: 3 }).catch((e) => e);
    expect(err.message).toContain("Too many redirects");
  });

  test("refuses a declared length over maxBytes", async () => {
    const err = await guardedFetch(`${base}/big`, opts).catch((e) => e);
    expect(err).toBeInstanceOf(ResponseTooLargeError);
  });

  test("cuts off a streamed body that runs past maxBytes", async () => {
    const err = await guardedFetch(`${base}/big-streamed`, opts).catch((e) => e);
    expect(err).toBeInstanceOf(ResponseTooLargeError);
  });

  test("decodes a gzip body", async () => {
    const res = await guardedFetch(`${base}/gzip`, opts);
    expect(res.text()).toBe("compressed body");
  });

  test("returns a non-2xx response instead of throwing", async () => {
    const res = await guardedFetch(`${base}/404`, opts);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  test("times out a host that never answers", async () => {
    const started = Date.now();
    const err = await guardedFetch(`${base}/stall`, { ...opts, timeoutMs: 200 }).catch((e) => e);
    expect(err.message).toContain("Timed out");
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
