import { expect, test } from "bun:test";

import type { Column } from "./colosseum/column";
import { blockMediaUrl, neighbourBlocks, prefersReducedData } from "./prefetch";

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

const board = [1, 2, 3, 4, 5].map((id) => column({ id }));
const ids = (columns: Column[]) => columns.map((c) => c.id);

test("neighbourBlocks warms the block on either side of the open one", () => {
  // ← is as common as → when you overshoot, so both sides get warmed.
  expect(ids(neighbourBlocks(board, 2))).toEqual([2, 4]);
});

test("neighbourBlocks clamps at the ends of the list", () => {
  expect(ids(neighbourBlocks(board, 0))).toEqual([2]);
  expect(ids(neighbourBlocks(board, 4))).toEqual([4]);
});

test("neighbourBlocks returns nothing when no block is open", () => {
  // Also the explore feed's case: it opens one block at a time with no sibling
  // list, so it falls out here instead of needing its own path.
  expect(neighbourBlocks(board, -1)).toEqual([]);
  expect(neighbourBlocks([], -1)).toEqual([]);
});

test("neighbourBlocks takes a wider radius nearest-first", () => {
  expect(ids(neighbourBlocks(board, 2, 2))).toEqual([2, 4, 1, 5]);
  expect(ids(neighbourBlocks(board, 0, 3))).toEqual([2, 3, 4]);
});

test("neighbourBlocks warms nothing at a radius of zero", () => {
  expect(neighbourBlocks(board, 2, 0)).toEqual([]);
});

test("prefersReducedData is false when nothing reports a metered connection", () => {
  // No `connection` to read here (nor on a server render), so nothing is
  // suppressed; the browser-only check lives in prefetchBlockMedia itself.
  expect(prefersReducedData()).toBe(false);
});
