import { expect, test } from "bun:test";

import {
  imageSrcFromHtml,
  isImageUrl,
  isSpotifyUrl,
  youtubeChannelRef,
  isTweetUrl,
  isYouTubeUrl,
  screenshotSrc,
  spotifyEmbedRef,
  thumbSrc,
  tweetIdFromUrl,
  youtubeIdFromUrl,
} from "./utils";

test("tweetIdFromUrl extracts the status id from twitter.com / x.com URLs", () => {
  expect(tweetIdFromUrl("https://twitter.com/jack/status/20")).toBe("20");
  expect(tweetIdFromUrl("https://x.com/jack/status/1234567890123456789")).toBe(
    "1234567890123456789",
  );
  // No scheme, www/mobile hosts, trailing query/segments.
  expect(tweetIdFromUrl("x.com/jack/status/42?s=20")).toBe("42");
  expect(tweetIdFromUrl("www.twitter.com/jack/status/42")).toBe("42");
  expect(tweetIdFromUrl("https://mobile.twitter.com/jack/status/42/photo/1")).toBe("42");
});

test("tweetIdFromUrl rejects non-tweet URLs", () => {
  expect(tweetIdFromUrl("https://x.com/jack")).toBeNull();
  expect(tweetIdFromUrl("https://example.com/jack/status/20")).toBeNull();
  expect(tweetIdFromUrl("https://x.com/i/status/notanumber")).toBeNull();
  expect(tweetIdFromUrl("not a url")).toBeNull();
  expect(isTweetUrl("https://x.com/jack/status/20")).toBe(true);
  expect(isTweetUrl("https://example.com")).toBe(false);
});

test("youtubeIdFromUrl extracts the video id from the various YouTube URL forms", () => {
  expect(youtubeIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(youtubeIdFromUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(youtubeIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  expect(youtubeIdFromUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  // No scheme, m./music. hosts, extra query params.
  expect(youtubeIdFromUrl("youtu.be/dQw4w9WgXcQ?t=30")).toBe("dQw4w9WgXcQ");
  expect(youtubeIdFromUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x")).toBe("dQw4w9WgXcQ");
});

test("youtubeIdFromUrl rejects non-YouTube and malformed URLs", () => {
  expect(youtubeIdFromUrl("https://youtube.com/watch?v=short")).toBeNull();
  expect(youtubeIdFromUrl("https://www.youtube.com/@channel")).toBeNull();
  expect(youtubeIdFromUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  expect(youtubeIdFromUrl("not a url")).toBeNull();
  expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  expect(isYouTubeUrl("https://example.com")).toBe(false);
});

test("youtubeChannelRef normalizes every channel URL form to the channel root", () => {
  expect(youtubeChannelRef("https://www.youtube.com/@syntaxfm")).toEqual({
    label: "@syntaxfm",
    url: "https://www.youtube.com/@syntaxfm",
  });
  // A tab is still the same channel.
  expect(youtubeChannelRef("https://www.youtube.com/@syntaxfm/videos")?.url).toBe(
    "https://www.youtube.com/@syntaxfm",
  );
  expect(youtubeChannelRef("https://m.youtube.com/@syntaxfm/streams")?.label).toBe("@syntaxfm");
  expect(youtubeChannelRef("https://www.youtube.com/channel/UCyU5wkjgQYGRB0hIHMwm2Sg")?.url).toBe(
    "https://www.youtube.com/channel/UCyU5wkjgQYGRB0hIHMwm2Sg",
  );
  expect(youtubeChannelRef("youtube.com/c/SomeName/playlists")?.url).toBe(
    "https://www.youtube.com/c/SomeName",
  );
  expect(youtubeChannelRef("https://www.youtube.com/user/SomeName")?.label).toBe("SomeName");
});

test("youtubeChannelRef rejects videos and non-channel pages", () => {
  // Video URLs belong to youtubeIdFromUrl, not here.
  expect(youtubeChannelRef("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  expect(youtubeChannelRef("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBeNull();
  expect(youtubeChannelRef("https://youtu.be/dQw4w9WgXcQ")).toBeNull();
  // A channel tab we know, versus a deeper page that isn't the channel.
  expect(youtubeChannelRef("https://www.youtube.com/@syntaxfm/video/abc")).toBeNull();
  expect(youtubeChannelRef("https://www.youtube.com/feed/subscriptions")).toBeNull();
  expect(youtubeChannelRef("https://www.youtube.com/")).toBeNull();
  expect(youtubeChannelRef("https://notyoutube.com/@syntaxfm")).toBeNull();
  expect(youtubeChannelRef("not a url")).toBeNull();
});

test("spotifyEmbedRef extracts the type and id from open.spotify.com URLs", () => {
  expect(spotifyEmbedRef("https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6")).toEqual({
    type: "track",
    id: "6rqhFgbbKwnb9MLmUQDhG6",
  });
  expect(spotifyEmbedRef("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")).toEqual({
    type: "playlist",
    id: "37i9dQZF1DXcBWIGoYBM5M",
  });
  // Locale prefix and ?si= tracking query are ignored.
  expect(spotifyEmbedRef("https://open.spotify.com/intl-de/album/1234abcd?si=xyz")).toEqual({
    type: "album",
    id: "1234abcd",
  });
  expect(spotifyEmbedRef("open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF")).toEqual({
    type: "artist",
    id: "0OdUWJ0sBjDrqHygGUXeCF",
  });
});

test("spotifyEmbedRef rejects non-Spotify and unsupported URLs", () => {
  expect(spotifyEmbedRef("https://open.spotify.com/user/someone")).toBeNull(); // unsupported type
  expect(spotifyEmbedRef("https://open.spotify.com/track/")).toBeNull(); // no id
  expect(spotifyEmbedRef("https://spotify.com/track/abc")).toBeNull(); // wrong host
  expect(spotifyEmbedRef("not a url")).toBeNull();
  expect(isSpotifyUrl("https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6")).toBe(true);
  expect(isSpotifyUrl("https://example.com")).toBe(false);
});

test("isImageUrl spots a URL pointing straight at an image file", () => {
  expect(isImageUrl("https://i.sstatic.net/zpzPO.gif")).toBe(true);
  expect(isImageUrl("i.sstatic.net/zpzPO.gif")).toBe(true);
  expect(isImageUrl("https://example.com/a/b/photo.JPEG?w=100")).toBe(true);
  expect(isImageUrl("https://example.com/pic.avif#top")).toBe(true);
});

test("isImageUrl rejects pages, unsupported types, and malformed input", () => {
  expect(isImageUrl("https://example.com")).toBe(false);
  expect(isImageUrl("https://example.com/gallery")).toBe(false);
  // The query string names an image, the path doesn't.
  expect(isImageUrl("https://example.com/view?src=cat.gif")).toBe(false);
  // SVG isn't an allowed upload type, so it stays a link block.
  expect(isImageUrl("https://example.com/logo.svg")).toBe(false);
  expect(isImageUrl("not a url")).toBe(false);
});

test("imageSrcFromHtml pulls the absolute <img> source a browser image-copy drops", () => {
  // What Chrome/Firefox put on the clipboard for a copied GIF.
  expect(
    imageSrcFromHtml(
      '<meta charset="utf-8"><img src="https://media.giphy.com/x/giphy.gif" alt="">',
    ),
  ).toBe("https://media.giphy.com/x/giphy.gif");
  // Attribute order / single quotes shouldn't matter.
  expect(imageSrcFromHtml("<img alt='a' src='http://e.com/a.png'>")).toBe("http://e.com/a.png");
});

test("imageSrcFromHtml returns null when there's no usable absolute image URL", () => {
  expect(imageSrcFromHtml("")).toBeNull();
  expect(imageSrcFromHtml("<p>just text</p>")).toBeNull();
  // Non-http(s) srcs (data:, blob:, relative) fall back to the clipboard file.
  expect(imageSrcFromHtml('<img src="data:image/png;base64,AAAA">')).toBeNull();
  expect(imageSrcFromHtml('<img src="/local/relative.gif">')).toBeNull();
});

test("screenshotSrc appends the cache-busting version token", () => {
  expect(screenshotSrc("https://cdn.example.com/a.png", "2026-01-02T03:04:05.000Z")).toBe(
    "https://cdn.example.com/a.png?v=2026-01-02T03%3A04%3A05.000Z",
  );
  // Numeric versions round-trip the same as string ones.
  expect(screenshotSrc("https://cdn.example.com/a.png", 1735786800000)).toBe(
    "https://cdn.example.com/a.png?v=1735786800000",
  );
});

test("screenshotSrc falls back to the bare image URL when there's no version", () => {
  const url = "https://cdn.example.com/a.png";
  expect(screenshotSrc(url, null)).toBe(url);
  expect(screenshotSrc(url, undefined)).toBe(url);
  // An empty token would produce a `?v=` that no prefetch would ever match.
  expect(screenshotSrc(url, "")).toBe(url);
});

test("screenshotSrc returns null when there's no screenshot", () => {
  expect(screenshotSrc(null, "2026-01-02T03:04:05.000Z")).toBeNull();
  expect(screenshotSrc(undefined, null)).toBeNull();
  expect(screenshotSrc("", "2026-01-02T03:04:05.000Z")).toBeNull();
});

test("thumbSrc points at the same rendition the grid card renders", () => {
  // Byte-for-byte identical to the card's URL, or the modal's placeholder is a
  // second request instead of a cache hit.
  expect(thumbSrc("/api/media/abc")).toBe("/api/media/abc?thumb");
});

test("thumbSrc returns null when the block has no image", () => {
  expect(thumbSrc(null)).toBeNull();
  expect(thumbSrc(undefined)).toBeNull();
  expect(thumbSrc("")).toBeNull();
});
