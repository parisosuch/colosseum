// Colosseum service worker. Intentionally conservative: it stores nothing the
// server has not declared reusable by anyone, so nothing can go stale or leak
// between users.
//
// - /api/*: never intercepted (auth, RSC, screenshots), with one exception —
//   image bytes the media route itself marked `public`. See isPublicResponse.
// - cross-origin: never intercepted.
// - navigations: network-first, falling back to the cached page or /offline.
// - immutable static assets (/_next/static, icons, fonts): cache-first.
// - public media images: cache-first, with a bounded lifetime.
// Bump a cache name to invalidate its contents on the next activation.

const CACHE = "colosseum-v1";
const MEDIA_CACHE = "colosseum-media-v1";
const KEEP = [CACHE, MEDIA_CACHE];
const OFFLINE_URL = "/offline";

// A media id's bytes never change, but its *visibility* can: a channel flipping
// to private updates the media rows and the route starts 404ing everyone who
// isn't a member. A copy already sitting in a browser survives that — which is
// the trade `public, max-age=31536000, immutable` already makes with the HTTP
// cache, for a year. Re-asking after a week keeps our window far shorter than
// the one the header hands out, and still covers every repeat visit that
// matters.
const MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MEDIA_CACHED_AT = "x-sw-cached-at";
// A ceiling on the media cache so a few image-heavy channels can't fill the
// origin's quota and take the offline page down with them.
const MEDIA_MAX_ENTRIES = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static") ||
    /\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)
  );
}

// The directive names in a Cache-Control header, lowercased. A quoted field list
// (`no-cache="Set-Cookie"`) survives the comma split mangled, but its head still
// yields the name, which is all this is used for.
function directives(value) {
  return value
    .toLowerCase()
    .split(",")
    .map((part) => part.trim().split("=")[0].trim());
}

// Whether a response may be handed to a later, possibly different, viewer.
//
// The media route emits `public, max-age=31536000, immutable` for public bytes
// and `private, no-cache` for private ones. Every other branch is already
// unqualified: a 404 for a blob the viewer may not read, the 302 to a CDN or
// signed URL (both `private`), a 206 range slice, a 416. An opaque response —
// what a cross-origin redirect collapses to for a no-cors image request — has
// status 0 and no readable headers, so it fails here too.
//
// The rule is a positive one on purpose: only an explicit `public` with nothing
// contradicting it gets stored. Missing, unparseable, or ambiguous falls through
// uncached.
function isPublicResponse(response) {
  if (response.status !== 200) return false;
  if (response.type !== "basic" && response.type !== "default") return false;
  if (response.redirected) return false;

  const control = directives(response.headers.get("cache-control") || "");
  if (!control.includes("public")) return false;
  if (control.some((d) => d === "private" || d === "no-store" || d === "no-cache")) return false;

  // A body that depends on who asked can't be replayed to anyone else.
  const vary = (response.headers.get("vary") || "").toLowerCase();
  if (vary.split(",").some((f) => ["*", "cookie", "authorization"].includes(f.trim())))
    return false;

  return true;
}

// Entries carry the time they were stored; anything without a usable stamp is
// treated as past its window and re-fetched.
function isFresh(response) {
  const stamp = Number(response.headers.get(MEDIA_CACHED_AT));
  if (!Number.isFinite(stamp) || stamp <= 0) return false;
  return Date.now() - stamp < MEDIA_MAX_AGE_MS;
}

async function storeMedia(request, response) {
  const headers = new Headers(response.headers);
  headers.set(MEDIA_CACHED_AT, String(Date.now()));
  const cache = await caches.open(MEDIA_CACHE);
  await cache.put(
    request,
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );

  const keys = await cache.keys();
  if (keys.length > MEDIA_MAX_ENTRIES) {
    // keys() is in insertion order, so the head is the oldest.
    await Promise.all(
      keys.slice(0, keys.length - MEDIA_MAX_ENTRIES).map((key) => cache.delete(key)),
    );
  }
}

async function serveMedia(event, request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    if (isFresh(cached)) return cached;
    // Past its window: drop the copy and ask again rather than serve bytes whose
    // visibility we can no longer vouch for. Offline that means a broken tile,
    // which is what an uncached one gives today anyway.
    await cache.delete(request);
  }

  const response = await fetch(request);
  if (isPublicResponse(response)) {
    event.waitUntil(storeMedia(request, response.clone()));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api")) {
    // Images only: a video or PDF from the same route arrives with a Range
    // header and expects a 206, which a stored full response would break.
    if (
      url.pathname.startsWith("/api/media/") &&
      request.destination === "image" &&
      !request.headers.has("range")
    ) {
      event.respondWith(serveMedia(event, request));
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)),
      ),
    );
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
