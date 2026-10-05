// Server-side fetches of URLs a user handed us: an image to ingest, a page to
// pull Open Graph tags from, a channel page to read. Without a guard, any
// signed-in user could point the server at loopback, the compose network's
// Postgres and Redis, or a cloud metadata endpoint, and read back whatever
// came out of it as a block.
//
// Every hop (the first request and each redirect) goes through the same
// three steps: only http/https, resolve the host, refuse if any address it
// resolves to is not publicly routable. The connection is then made to the
// address that was checked, through a `lookup` that hands back the pinned
// result instead of asking DNS again, so a record that changes between the
// check and the connect (DNS rebinding) can't swap a private address in.
//
// Fixed third-party API hosts (api.github.com, the oEmbed endpoints) don't go
// through here: their host isn't user-controlled.
//
// Deliberately free of DB / server-only imports so the parsers that call it
// stay unit-testable.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

export class ResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Response is larger than ${maxBytes} bytes.`);
    this.name = "ResponseTooLargeError";
  }
}

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
// Why an address must not be fetched, or null when it's publicly routable.
export type AddressPolicy = (address: string) => string | null;

// Same lookup the platform's own fetch does (getaddrinfo, so /etc/hosts and
// the compose network's embedded DNS both apply).
export const systemResolver: Resolver = async (hostname) => {
  const found = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return found.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

// Small on purpose: a legitimate image or page redirects once or twice
// (http→https, a CDN hop). Every hop is re-checked, so the cap is about
// bounding work, not safety.
export const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function ipv4Reason(o: number[]): string | null {
  const [a, b, c] = o;
  if (a === 0) return "unspecified";
  if (a === 10) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "shared (CGNAT)";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 192 && b === 0 && c === 0) return "reserved";
  if (a === 198 && (b === 18 || b === 19)) return "reserved";
  if (a >= 224) return "multicast or reserved";
  return null;
}

function parseIPv4(s: string): number[] {
  return s.split(".").map(Number);
}

// Eight 16-bit groups. Expects a string net.isIPv6 already accepted, so "::"
// appears at most once and a dotted IPv4 tail is well formed.
function parseIPv6(s: string): number[] {
  let text = s;
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = parseIPv4(dotted[1]);
    tail.push((a << 8) | b, (c << 8) | d);
    text = text.slice(0, -dotted[1].length);
    // "::ffff:1.2.3.4" leaves "::ffff:", "1::1.2.3.4" leaves "1::"
    if (text.endsWith(":") && !text.endsWith("::")) text = text.slice(0, -1);
  }
  const groups = (part: string) => (part === "" ? [] : part.split(":").map((g) => parseInt(g, 16)));
  const [head, rest] = text.split("::");
  const left = groups(head);
  const right = rest === undefined ? [] : groups(rest);
  const fill = 8 - tail.length - left.length - right.length;
  return [...left, ...Array<number>(Math.max(fill, 0)).fill(0), ...right, ...tail];
}

function embeddedIPv4(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function ipv6Reason(g: number[]): string | null {
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8)) return "unspecified";
  if (zeros(0, 7) && g[7] === 1) return "loopback";
  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible (::a.b.c.d)
  // forms reach the IPv4 address inside them, so they get its verdict.
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) return ipv4Reason(embeddedIPv4(g[6], g[7]));
  // NAT64 (64:ff9b::/96) is how an IPv6-only host reaches the IPv4 internet,
  // so a public IPv4 inside it must stay fetchable.
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) {
    return ipv4Reason(embeddedIPv4(g[6], g[7]));
  }
  // 6to4 carries an IPv4 address in its second and third groups.
  if (g[0] === 0x2002) return ipv4Reason(embeddedIPv4(g[1], g[2]));
  if ((g[0] & 0xfe00) === 0xfc00) return "private (ULA)";
  if ((g[0] & 0xffc0) === 0xfe80) return "link-local";
  if ((g[0] & 0xff00) === 0xff00) return "multicast";
  // Teredo tunnels to an obfuscated IPv4 address that can't be checked.
  if (g[0] === 0x2001 && g[1] === 0) return "reserved";
  // Global unicast is 2000::/3. Everything else left (local-use NAT64,
  // discard, site-local, unassigned space) isn't a public host.
  if ((g[0] & 0xe000) !== 0x2000) return "reserved";
  return null;
}

// Why the server must not connect to this address, or null when it's public.
// Covers loopback, RFC 1918, CGNAT, link-local (cloud metadata lives at
// 169.254.169.254), unspecified, multicast and reserved space, and the IPv6
// equivalents including IPv4 addresses wrapped in IPv6.
export const blockedAddressReason: AddressPolicy = (address) => {
  const bare = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  switch (net.isIP(bare)) {
    case 4:
      return ipv4Reason(parseIPv4(bare));
    case 6:
      return ipv6Reason(parseIPv6(bare));
    default:
      return "invalid";
  }
};

function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

// Parse and scheme-check a URL. Throws BlockedUrlError for anything but
// http/https (file:, data:, ftp:, gopher: …).
export function toHttpUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new BlockedUrlError("That isn't a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Refusing to fetch a ${url.protocol} URL: only http and https.`);
  }
  return url;
}

type GuardOptions = {
  resolver?: Resolver;
  // Tests swap this to let a loopback test server stand in for a public host.
  policy?: AddressPolicy;
};

// Resolve a hostname and return its addresses, or throw BlockedUrlError if any
// of them isn't public. All of them, not just the first: a host with one public
// and one private record would otherwise get through whenever the connect picks
// the private one.
export async function resolvePublicHost(
  hostname: string,
  { resolver = systemResolver, policy = blockedAddressReason }: GuardOptions = {},
): Promise<ResolvedAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const literal = net.isIP(host);
  let addresses: ResolvedAddress[];
  if (literal) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      throw new Error(`Couldn't resolve ${host}.`);
    }
    if (addresses.length === 0) throw new Error(`Couldn't resolve ${host}.`);
  }
  for (const { address } of addresses) {
    const reason = policy(address);
    if (reason) {
      throw new BlockedUrlError(
        literal
          ? `Refusing to fetch ${hostname}: it is a ${reason} address.`
          : `Refusing to fetch ${host}: it resolves to a ${reason} address.`,
      );
    }
  }
  return addresses;
}

// Check a URL without fetching it: scheme, then every address its host
// resolves to. For callers that hand the URL to something else to fetch.
export async function assertPublicUrl(input: string | URL, opts: GuardOptions = {}): Promise<URL> {
  const url = toHttpUrl(input);
  await resolvePublicHost(url.hostname, opts);
  return url;
}

// A `lookup` for http.request / net.connect that answers with addresses that
// were already checked, and never consults DNS.
export function pinnedLookup(addresses: ResolvedAddress[]): net.LookupFunction {
  return ((
    _hostname: string,
    options: dns.LookupOptions,
    callback: (...args: unknown[]) => void,
  ) => {
    if (options?.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  }) as unknown as net.LookupFunction;
}

export type GuardedResponse = {
  // The URL the body came from, after redirects.
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  body: Buffer<ArrayBuffer>;
  text(): string;
};

export type GuardedFetchOptions = GuardOptions & {
  headers?: Record<string, string>;
  // One budget for the whole chain: every DNS lookup, redirect and the body.
  timeoutMs: number;
  // Hard cap on the (decoded) body. A declared content-length over it fails
  // before reading; a body that runs past it is cut off.
  maxBytes: number;
  maxRedirects?: number;
};

type Hop = { status: number; headers: http.IncomingHttpHeaders; body: Buffer<ArrayBuffer> };

function toHeaders(raw: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  return headers;
}

function decoder(
  encoding: string | undefined,
): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null | "unsupported" {
  const enc = (encoding ?? "").trim().toLowerCase();
  if (enc === "" || enc === "identity") return null;
  if (enc === "gzip" || enc === "x-gzip") return zlib.createGunzip();
  if (enc === "deflate") return zlib.createInflate();
  if (enc === "br") return zlib.createBrotliDecompress();
  return "unsupported";
}

function requestOnce(
  url: URL,
  addresses: ResolvedAddress[],
  opts: GuardedFetchOptions,
  deadline: number,
): Promise<Hop> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req: http.ClientRequest | undefined;
    const finish = (err: Error | null, hop?: Hop) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      if (err) reject(err);
      else resolve(hop!);
    };
    const timer = setTimeout(
      () => finish(new Error(`Timed out fetching ${url.host}.`)),
      Math.max(deadline - Date.now(), 0),
    );

    const mod = url.protocol === "https:" ? https : http;
    req = mod.request(
      {
        protocol: url.protocol,
        hostname: bareHostname(url),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        // Host is the name, not the pinned address, so virtual hosting and
        // TLS (SNI and certificate checks use `hostname`) work as normal.
        headers: { ...opts.headers, Host: url.host },
        // A fresh connection per request: a pooled socket could have been
        // opened for a different check.
        agent: false,
        lookup: pinnedLookup(addresses),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (REDIRECT_STATUSES.has(status) && res.headers.location) {
          finish(null, { status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        if (Number(res.headers["content-length"]) > opts.maxBytes) {
          finish(new ResponseTooLargeError(opts.maxBytes));
          return;
        }
        const decode = decoder(res.headers["content-encoding"]);
        if (decode === "unsupported") {
          finish(new Error(`Unsupported content-encoding from ${url.host}.`));
          return;
        }
        const stream: Readable = decode ? res.pipe(decode) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            finish(new ResponseTooLargeError(opts.maxBytes));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () =>
          finish(null, { status, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        stream.on("error", (e) => finish(new Error(`Couldn't read ${url.host}.`, { cause: e })));
        res.on("error", (e) => finish(new Error(`Couldn't read ${url.host}.`, { cause: e })));
      },
    );
    req.on("error", (e) => finish(new Error(`Couldn't reach ${url.host}.`, { cause: e })));
    req.end();
  });
}

function withDeadline<T>(promise: Promise<T>, deadline: number, host: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out fetching ${host}.`)),
      Math.max(deadline - Date.now(), 0),
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// GET a user-supplied URL with the guard applied to every hop. Throws
// BlockedUrlError when a hop is refused, ResponseTooLargeError past maxBytes,
// and a plain Error on network failure, timeout or too many redirects. A non-2xx
// final response is returned, not thrown, like fetch.
export async function guardedFetch(
  input: string | URL,
  opts: GuardedFetchOptions,
): Promise<GuardedResponse> {
  const deadline = Date.now() + opts.timeoutMs;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  let url = toHttpUrl(input);
  for (let redirects = 0; ; redirects++) {
    const addresses = await withDeadline(resolvePublicHost(url.hostname, opts), deadline, url.host);
    const hop = await requestOnce(url, addresses, opts, deadline);
    const location = hop.headers.location;
    if (REDIRECT_STATUSES.has(hop.status) && location) {
      if (redirects >= maxRedirects) {
        throw new Error(`Too many redirects fetching ${toHttpUrl(input).host}.`);
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new Error(`Bad redirect from ${url.host}.`);
      }
      url = toHttpUrl(next);
      continue;
    }
    const body = hop.body;
    return {
      url: url.href,
      status: hop.status,
      ok: hop.status >= 200 && hop.status < 300,
      headers: toHeaders(hop.headers),
      body,
      text: () => body.toString("utf8"),
    };
  }
}
