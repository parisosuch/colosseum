// Tests for public/sw.js. Not colocated: everything under public/ is served
// verbatim by Next, and a test file doesn't belong on the wire.
//
// The worker ships as a plain script, so there is nothing to import. It is
// evaluated here inside a stand-in worker scope — a fake CacheStorage, a
// scriptable fetch, a listener registry — which means these assertions run
// against the file that actually ships, not a copy of its rules.

import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";

import { MEDIA_REDIRECT_CACHE_CONTROL, mediaCacheControl } from "./colosseum/media-cache";

const ORIGIN = "https://colosseum.test";
const MEDIA_URL = `${ORIGIN}/api/media/6f1b0e0c-0000-4000-8000-000000000001`;
const PUBLIC_BYTES = "public, max-age=31536000, immutable";
const DAY_MS = 24 * 60 * 60 * 1000;

const source = await Bun.file(new URL("../public/sw.js", import.meta.url)).text();

type Stored = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
};

function keyOf(request: Request | string): string {
  return typeof request === "string" ? new URL(request, ORIGIN).toString() : request.url;
}

class FakeCache {
  entries = new Map<string, Stored>();

  constructor(private fetcher: (request: Request | string) => Promise<Response>) {}

  async put(request: Request | string, response: Response) {
    const key = keyOf(request);
    const stored: Stored = {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
      body: await response.arrayBuffer(),
    };
    // A re-put keeps its original position in a real Cache; insertion order is
    // only what this suite reads it for, and re-storing is the rarer path.
    this.entries.set(key, stored);
  }

  async match(request: Request | string) {
    const stored = this.entries.get(keyOf(request));
    if (!stored) return undefined;
    return new Response(stored.body, {
      status: stored.status,
      statusText: stored.statusText,
      headers: stored.headers,
    });
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async delete(request: Request | string) {
    return this.entries.delete(keyOf(request));
  }

  async add(url: string) {
    await this.put(url, await this.fetcher(url));
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();

  constructor(private fetcher: (request: Request | string) => Promise<Response>) {}

  async open(name: string) {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache(this.fetcher);
      this.caches.set(name, cache);
    }
    return cache;
  }

  async keys() {
    return [...this.caches.keys()];
  }

  async delete(name: string) {
    return this.caches.delete(name);
  }

  async match(request: Request | string) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

type Handler = (request: Request) => Promise<Response> | Response;

type Worker = {
  listeners: Map<string, (event: unknown) => void>;
  storage: FakeCacheStorage;
  media: () => FakeCache | undefined;
  calls: string[];
  serve: (handler: Handler) => void;
};

function load(): Worker {
  const listeners = new Map<string, (event: unknown) => void>();
  const calls: string[] = [];
  let handler: Handler = () => {
    throw new Error("no network handler installed");
  };

  const fetcher = async (input: Request | string) => {
    const request = typeof input === "string" ? new Request(new URL(input, ORIGIN)) : input;
    calls.push(request.url);
    return handler(request);
  };

  const storage = new FakeCacheStorage(fetcher);
  const scope = {
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    location: { origin: ORIGIN },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };

  new Function("self", "caches", "fetch", source)(scope, storage, fetcher);

  return {
    listeners,
    storage,
    media: () => storage.caches.get("colosseum-media-v1"),
    calls,
    serve: (next: Handler) => {
      handler = next;
    },
  };
}

// Drives one fetch event and settles whatever the worker handed to waitUntil,
// so a store that happens off the response path has finished before we assert.
async function dispatch(worker: Worker, request: Request) {
  let responded: Promise<Response> | Response | undefined;
  const pending: Promise<unknown>[] = [];
  worker.listeners.get("fetch")?.({
    request,
    respondWith: (value: Promise<Response> | Response) => {
      responded = value;
    },
    waitUntil: (value: Promise<unknown>) => {
      pending.push(value);
    },
  });
  const response = responded === undefined ? undefined : await responded;
  await Promise.all(pending);
  return response;
}

function request(url: string, destination = "image", headers: Record<string, string> = {}) {
  const built = new Request(url, { headers });
  Object.defineProperty(built, "destination", { value: destination });
  Object.defineProperty(built, "mode", { value: "no-cors" });
  return built;
}

// A response as the media route would emit it, with the knobs the classifier
// reads. `type` and `redirected` are read-only on a constructed Response, so
// they get stamped on.
function response(
  body: string | null,
  init: ResponseInit & { type?: string; redirected?: boolean } = {},
) {
  // The Response constructor rejects a status outside 200-599, which is exactly
  // what an opaque response reports, so that one gets stamped on as well.
  const opaque = init.status === 0;
  const built = new Response(body, { ...init, status: opaque ? 200 : init.status });
  if (opaque) Object.defineProperty(built, "status", { value: 0 });
  if (init.type) Object.defineProperty(built, "type", { value: init.type });
  if (init.redirected) Object.defineProperty(built, "redirected", { value: true });
  return built;
}

beforeEach(() => setSystemTime(new Date("2026-03-01T00:00:00.000Z")));
afterEach(() => setSystemTime());

test("a public media image is stored, then served from the cache", async () => {
  const worker = load();
  worker.serve(() => response("pixels", { headers: { "Cache-Control": PUBLIC_BYTES } }));

  expect(await (await dispatch(worker, request(MEDIA_URL)))?.text()).toBe("pixels");
  expect(worker.media()?.entries.size).toBe(1);

  // The second visit must not touch the network at all.
  worker.serve(() => {
    throw new Error("offline");
  });
  expect(await (await dispatch(worker, request(MEDIA_URL)))?.text()).toBe("pixels");
  expect(worker.calls.length).toBe(1);
});

test("a private media image is never stored", async () => {
  const worker = load();
  worker.serve(() => response("secret", { headers: { "Cache-Control": "private, no-cache" } }));

  expect(await (await dispatch(worker, request(MEDIA_URL)))?.text()).toBe("secret");
  expect(worker.media()?.entries.size ?? 0).toBe(0);

  // And the next request goes back to the route, which re-runs its access check.
  await dispatch(worker, request(MEDIA_URL));
  expect(worker.calls.length).toBe(2);
});

// Every other branch app/api/media/[id]/route.ts can take, plus the shapes a
// redirect collapses to in a no-cors image fetch. None may be stored.
const uncacheable: [string, () => Response][] = [
  [
    "a 404 for a blob the viewer may not read",
    () => response('{"error":"Not found."}', { status: 404 }),
  ],
  [
    "the 302 handing public bytes to a CDN",
    () =>
      response(null, {
        status: 302,
        headers: {
          Location: "https://cdn.test/blob",
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      }),
  ],
  [
    "the 302 handing private bytes to a signed URL",
    () =>
      response(null, {
        status: 302,
        headers: { Location: "https://cdn.test/signed", "Cache-Control": "private, no-store" },
      }),
  ],
  [
    "a 206 range slice",
    () => response("half", { status: 206, headers: { "Cache-Control": PUBLIC_BYTES } }),
  ],
  ["a 416", () => response(null, { status: 416 })],
  ["a 304", () => response(null, { status: 304, headers: { "Cache-Control": PUBLIC_BYTES } })],
  ["a 200 with no Cache-Control at all", () => response("pixels")],
  ["a 200 whose policy is empty", () => response("pixels", { headers: { "Cache-Control": "" } })],
  [
    "public contradicted by no-store",
    () => response("pixels", { headers: { "Cache-Control": "public, no-store" } }),
  ],
  [
    "public contradicted by no-cache",
    () => response("pixels", { headers: { "Cache-Control": "public, no-cache" } }),
  ],
  [
    "public contradicted by a quoted no-cache field list",
    () =>
      response("pixels", {
        headers: { "Cache-Control": 'public, no-cache="Set-Cookie, X-Thing"' },
      }),
  ],
  [
    "a body that varies by cookie",
    () =>
      response("pixels", {
        headers: { "Cache-Control": PUBLIC_BYTES, Vary: "Accept-Encoding, Cookie" },
      }),
  ],
  [
    "a body that varies by everything",
    () => response("pixels", { headers: { "Cache-Control": PUBLIC_BYTES, Vary: "*" } }),
  ],
  ["an opaque response, headers unreadable", () => response(null, { status: 0, type: "opaque" })],
  [
    "a followed redirect, whatever it ended up at",
    () => response("pixels", { headers: { "Cache-Control": PUBLIC_BYTES }, redirected: true }),
  ],
];

for (const [name, make] of uncacheable) {
  test(`${name} is not stored`, async () => {
    const worker = load();
    worker.serve(make);
    await dispatch(worker, request(MEDIA_URL));
    expect(worker.media()?.entries.size ?? 0).toBe(0);
  });
}

test("only a positive public signal gets stored, across every branch at once", async () => {
  // The same assertion as the table above, made once over the whole set: after
  // running each non-public branch against its own media id, nothing is stored.
  const worker = load();
  for (const [index, [, make]] of uncacheable.entries()) {
    worker.serve(make);
    await dispatch(worker, request(`${ORIGIN}/api/media/id-${index}`));
  }
  expect(worker.media()?.entries.size ?? 0).toBe(0);
});

// The worker classifies by header, so the headers the route actually emits are
// part of its contract. If lib/colosseum/media-cache.ts ever changes what it
// says, this is what notices.
test("the route's own policies land on the right side of the rule", async () => {
  const store = async (control: string) => {
    const worker = load();
    worker.serve(() => response("pixels", { headers: { "Cache-Control": control } }));
    await dispatch(worker, request(MEDIA_URL));
    return worker.media()?.entries.size ?? 0;
  };

  expect(await store(mediaCacheControl("public"))).toBe(1);
  expect(await store(mediaCacheControl("private"))).toBe(0);
  // The redirect's policy is `private` even for public media, so a redirect
  // body that somehow arrived as a 200 still wouldn't be stored.
  expect(await store(MEDIA_REDIRECT_CACHE_CONTROL)).toBe(0);
});

test("a stored image is dropped and re-fetched once its window closes", async () => {
  const worker = load();
  worker.serve(() => response("pixels", { headers: { "Cache-Control": PUBLIC_BYTES } }));
  await dispatch(worker, request(MEDIA_URL));
  expect(worker.media()?.entries.size).toBe(1);

  setSystemTime(new Date(Date.now() + 8 * DAY_MS));

  // The blob went private in the meantime: the route now 404s this viewer, and
  // the stale copy has to go with it rather than keep painting.
  worker.serve(() => response('{"error":"Not found."}', { status: 404 }));
  expect((await dispatch(worker, request(MEDIA_URL)))?.status).toBe(404);
  expect(worker.media()?.entries.size).toBe(0);
});

test("a stored image survives inside its window", async () => {
  const worker = load();
  worker.serve(() => response("pixels", { headers: { "Cache-Control": PUBLIC_BYTES } }));
  await dispatch(worker, request(MEDIA_URL));

  setSystemTime(new Date(Date.now() + 6 * DAY_MS));
  worker.serve(() => {
    throw new Error("offline");
  });
  expect(await (await dispatch(worker, request(MEDIA_URL)))?.text()).toBe("pixels");
});

test("an entry with no usable timestamp is treated as expired", async () => {
  const worker = load();
  const cache = await worker.storage.open("colosseum-media-v1");
  await cache.put(MEDIA_URL, response("stale", { headers: { "Cache-Control": PUBLIC_BYTES } }));

  worker.serve(() => response("fresh", { headers: { "Cache-Control": PUBLIC_BYTES } }));
  expect(await (await dispatch(worker, request(MEDIA_URL)))?.text()).toBe("fresh");
});

test("the /api bypass still holds for everything else", async () => {
  const worker = load();
  worker.serve(() => response("{}"));

  expect(await dispatch(worker, request(`${ORIGIN}/api/channels/1`, "empty"))).toBeUndefined();
  expect(await dispatch(worker, request(`${ORIGIN}/api/auth/session`, "empty"))).toBeUndefined();
  // Same route, but a video or PDF: those arrive ranged and expect a 206.
  expect(await dispatch(worker, request(MEDIA_URL, "video"))).toBeUndefined();
  expect(await dispatch(worker, request(MEDIA_URL, "document"))).toBeUndefined();
  // An image asking for a byte range is left alone too.
  expect(
    await dispatch(worker, request(MEDIA_URL, "image", { Range: "bytes=0-99" })),
  ).toBeUndefined();
  expect(worker.calls.length).toBe(0);
});

test("cross-origin media is never intercepted", async () => {
  const worker = load();
  worker.serve(() => response("pixels", { headers: { "Cache-Control": PUBLIC_BYTES } }));
  expect(await dispatch(worker, request("https://elsewhere.test/api/media/1"))).toBeUndefined();
});

test("the media cache is trimmed to a bound, oldest first", async () => {
  const worker = load();
  worker.serve((req) => response(req.url, { headers: { "Cache-Control": PUBLIC_BYTES } }));

  for (let i = 0; i < 405; i++) {
    await dispatch(worker, request(`${ORIGIN}/api/media/id-${i}`));
  }

  const entries = worker.media()!.entries;
  expect(entries.size).toBe(400);
  expect(entries.has(`${ORIGIN}/api/media/id-0`)).toBe(false);
  expect(entries.has(`${ORIGIN}/api/media/id-404`)).toBe(true);
});

test("activation keeps both caches and drops older ones", async () => {
  const worker = load();
  await worker.storage.open("colosseum-v1");
  await worker.storage.open("colosseum-media-v1");
  await worker.storage.open("colosseum-v0");

  const pending: Promise<unknown>[] = [];
  worker.listeners.get("activate")?.({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await Promise.all(pending);

  expect(await worker.storage.keys()).toEqual(["colosseum-v1", "colosseum-media-v1"]);
});

test("navigations still fall back to the offline page", async () => {
  const worker = load();
  worker.serve(() => response("<offline>"));
  const pending: Promise<unknown>[] = [];
  worker.listeners.get("install")?.({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await Promise.all(pending);

  worker.serve(() => {
    throw new Error("offline");
  });
  const nav = new Request(`${ORIGIN}/channels/1`);
  Object.defineProperty(nav, "mode", { value: "navigate" });
  Object.defineProperty(nav, "destination", { value: "document" });
  expect(await (await dispatch(worker, nav))?.text()).toBe("<offline>");
});
