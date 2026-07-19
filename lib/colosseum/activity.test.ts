import { expect, test } from "bun:test";

import { blockLabel } from "./activity";

const b = (over: Partial<Parameters<typeof blockLabel>[0]>) => ({
  type: "text",
  title: null,
  url: null,
  text: null,
  ...over,
});

test("prefers an explicit title", () => {
  expect(blockLabel(b({ type: "url", title: "My Link", url: "https://x.com" }))).toBe("My Link");
});

test("url without title shows the domain/path", () => {
  expect(blockLabel(b({ type: "url", url: "https://example.com/path" }))).toBe("example.com/path");
});

test("text without title is truncated", () => {
  expect(blockLabel(b({ type: "text", text: "x".repeat(80) }))).toBe("x".repeat(60));
});

test("image, video, and channel fall back to a noun", () => {
  expect(blockLabel(b({ type: "image" }))).toBe("an image");
  expect(blockLabel(b({ type: "video" }))).toBe("a video");
  expect(blockLabel(b({ type: "channel" }))).toBe("a channel");
});
