import { expect, test } from "bun:test";

import {
  imageSrcFromHtml,
  isTweetUrl,
  isYouTubeUrl,
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
