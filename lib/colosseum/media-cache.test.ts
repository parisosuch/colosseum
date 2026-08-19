import { expect, test } from "bun:test";

import {
  etagMatches,
  MEDIA_REDIRECT_CACHE_CONTROL,
  mediaCacheControl,
  mediaEtag,
} from "./media-cache";

const SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("private media is storable but never reused without revalidating", () => {
  const value = mediaCacheControl("private");
  expect(value).toContain("private");
  expect(value).toContain("no-cache");
  // A max-age would let a browser serve the bytes without asking us, so a
  // viewer who lost access could still see them until it expired.
  expect(value).not.toContain("max-age");
});

test("public media caches forever — an id's bytes never change", () => {
  expect(mediaCacheControl("public")).toBe("public, max-age=31536000, immutable");
});

test("the public media redirect is cached per-browser, never in a shared cache", () => {
  // `public` would let a proxy answer for the route after a channel flipped to
  // private, routing a viewer who never had access past the check. The object
  // stays readable at its CDN URL, so nothing invalidates such a copy.
  expect(MEDIA_REDIRECT_CACHE_CONTROL).toContain("private");
  expect(MEDIA_REDIRECT_CACHE_CONTROL).not.toContain("public");
  // It still has to be reusable without asking us, or the 50-tile grid keeps
  // paying a round trip per tile — that is the whole point of caching it.
  expect(MEDIA_REDIRECT_CACHE_CONTROL).toContain("max-age=31536000");
  expect(MEDIA_REDIRECT_CACHE_CONTROL).not.toContain("no-store");
});

test("mediaEtag is a strong tag, and the thumbnail gets its own", () => {
  expect(mediaEtag(SHA, false)).toBe(`"${SHA}"`);
  expect(mediaEtag(SHA, true)).toBe(`"${SHA}-thumb"`);
  expect(mediaEtag(SHA, false)).not.toBe(mediaEtag(SHA, true));
});

test("etagMatches handles a single tag, a list, and *", () => {
  const etag = mediaEtag(SHA, false);
  expect(etagMatches(etag, etag)).toBe(true);
  expect(etagMatches(`"other", ${etag}`, etag)).toBe(true);
  expect(etagMatches("*", etag)).toBe(true);
  // A proxy may hand back the tag we sent with a weak prefix.
  expect(etagMatches(`W/${etag}`, etag)).toBe(true);
});

test("etagMatches rejects a missing or different tag", () => {
  const etag = mediaEtag(SHA, false);
  expect(etagMatches(null, etag)).toBe(false);
  expect(etagMatches("", etag)).toBe(false);
  expect(etagMatches('"nope"', etag)).toBe(false);
  // The full-size tag must not satisfy a request holding the thumbnail.
  expect(etagMatches(mediaEtag(SHA, true), etag)).toBe(false);
});
