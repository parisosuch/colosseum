// Cache headers for the bytes served by app/api/media/[id]/route.ts.
//
// A media id's bytes never change — the id names one content-addressed blob —
// so its sha256 is a strong validator. What differs between public and private
// media is not *whether* a browser may store a copy, but whether it may reuse
// one on its own:
//
// - public: reusable by anyone, forever. The id → bytes mapping is immutable.
// - private: storable by the viewer's own browser (`private`), never reused
//   without checking with us first (`no-cache`). Every reuse becomes a
//   conditional request that re-runs the route's channel-access check, so a
//   viewer who has since lost access — or a different account signed in on the
//   same browser profile — revalidates into a 404 rather than a cache hit.
//   That is what makes storing private bytes safe: the copy is inert without
//   our say-so on each use.
//
// Deliberately not `max-age`: that would hand out a window in which a stored
// copy is served with no authorization check at all.
//
// No `Vary: Cookie` either — it would partition the cache by session cookie and
// evict every stored image the moment a session refreshes, which is the whole
// benefit gone. Revalidation already covers what Vary would.
//
// Kept free of server-only imports so it can be unit-tested.

export type MediaVisibility = "public" | "private";

export function mediaCacheControl(visibility: MediaVisibility): string {
  return visibility === "private" ? "private, no-cache" : "public, max-age=31536000, immutable";
}

// Cache policy for the 302 that hands public media off to the CDN, which is a
// different question from the bytes above. A media id names one blob forever,
// so the pointer is as immutable as what it points at — but `public` here would
// let a shared cache keep answering for the route after the answer stops being
// true. A channel flipping to private updates the media rows (and the route
// starts 404ing) while the object stays readable at its CDN URL, so a shared
// copy of the redirect would route a viewer who never had access straight past
// the check. `private` keeps the copy in the one browser that already passed it.
//
// That browser can still be stale after a flip, which is the same trade the
// immutable bytes above already make: a viewer who loaded the image while it
// was public keeps their copy either way. What this avoids is handing the
// pointer to viewers who never had it.
//
// The win is per-viewer anyway. Fifty tiles re-requesting the redirect on every
// repeat view and every scroll back is what this removes; a shared cache would
// only have helped each new viewer's first load.
export const MEDIA_REDIRECT_CACHE_CONTROL = "private, max-age=31536000, immutable";

// The `?thumb` rendition is different bytes derived from the same blob, so it
// needs a tag of its own or the two would collide in the browser's cache.
export function mediaEtag(sha256: string, thumb: boolean): string {
  return `"${sha256}${thumb ? "-thumb" : ""}"`;
}

// Whether an If-None-Match header covers `etag`. Handles the comma-separated
// list, `*`, and the `W/` prefix a proxy may put in front of a tag we sent
// unprefixed (weak comparison is the right one for If-None-Match).
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const strip = (tag: string) => tag.trim().replace(/^W\//, "");
  const target = strip(etag);
  return ifNoneMatch.split(",").some((tag) => {
    const candidate = strip(tag);
    return candidate === "*" || candidate === target;
  });
}
