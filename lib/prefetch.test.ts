import { expect, test } from "bun:test";

import type { Column } from "./colosseum/column";
import { blockMediaUrl } from "./prefetch";

const column = (over: Partial<Column>): Column => ({
  id: 1,
  created_at: new Date().toISOString(),
  type: "image",
  created_by: "user-1",
  channel_id: 1,
  tags: [],
  ...over,
});

test("blockMediaUrl returns the full-size media of an image block", () => {
  expect(blockMediaUrl(column({ type: "image", image: "/api/media/abc" }))).toBe("/api/media/abc");
});

test("blockMediaUrl ignores every other block type", () => {
  // A pdf block stores its file in `image` too, but the modal renders it in a
  // viewer that streams — there's nothing to warm.
  expect(blockMediaUrl(column({ type: "pdf", image: "/api/media/abc" }))).toBeNull();
  expect(blockMediaUrl(column({ type: "video", image: "/api/media/abc" }))).toBeNull();
  expect(blockMediaUrl(column({ type: "url", url: "https://example.com" }))).toBeNull();
  expect(blockMediaUrl(column({ type: "text", text: "hello" }))).toBeNull();
  expect(blockMediaUrl(column({ type: "tweet", url: "https://x.com/jack/status/20" }))).toBeNull();
});

test("blockMediaUrl returns null for an image block with no media", () => {
  expect(blockMediaUrl(column({ type: "image", image: undefined }))).toBeNull();
});
