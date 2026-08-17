import { expect, test } from "bun:test";

import type { Column } from "./colosseum/column";
import type { ColumnScreenshot } from "./colosseum/screenshot-data";
import {
  blockMediaUrl,
  blockPreconnectOrigins,
  claimPreconnect,
  neighbourBlocks,
  prefersReducedData,
} from "./prefetch";
import { screenshotSrc } from "./utils";

const column = (over: Partial<Column>): Column => ({
  id: 1,
  created_at: new Date().toISOString(),
  type: "image",
  created_by: "user-1",
  channel_id: 1,
  tags: [],
  ...over,
});

const shot = (over: Partial<ColumnScreenshot> = {}): ColumnScreenshot => ({
  url: "https://example.com",
  image_url: "https://cdn.example.com/shot.png",
  title: "Example",
  captured_at: "2026-01-02T03:04:05.000Z",
  ...over,
});

test("blockMediaUrl returns the full-size media of an image block", () => {
  expect(blockMediaUrl(column({ type: "image", image: "/api/media/abc" }))).toBe("/api/media/abc");
});

test("blockMediaUrl returns the cached screenshot of a url block", () => {
  const block = column({ type: "url", url: "https://example.com" });
  // Byte-for-byte what the card and the modal render, cache-busting token and
  // all — a different string would warm an entry neither of them asks for.
  expect(blockMediaUrl(block, shot())).toBe(
    "https://cdn.example.com/shot.png?v=2026-01-02T03%3A04%3A05.000Z",
  );
  expect(blockMediaUrl(block, shot())).toBe(
    screenshotSrc("https://cdn.example.com/shot.png", "2026-01-02T03:04:05.000Z"),
  );
});

test("blockMediaUrl returns null for a url block with nothing captured yet", () => {
  const block = column({ type: "url", url: "https://example.com" });
  // No entry in the board's map at all (still capturing), and a row recording a
  // capture that permanently failed.
  expect(blockMediaUrl(block)).toBeNull();
  expect(blockMediaUrl(block, shot({ image_url: null }))).toBeNull();
});

test("blockMediaUrl ignores every other block type", () => {
  // A pdf block stores its file in `image` too, but the modal renders it in a
  // viewer that streams — there's nothing to warm.
  expect(blockMediaUrl(column({ type: "pdf", image: "/api/media/abc" }))).toBeNull();
  expect(blockMediaUrl(column({ type: "video", image: "/api/media/abc" }))).toBeNull();
  expect(blockMediaUrl(column({ type: "text", text: "hello" }))).toBeNull();
  expect(blockMediaUrl(column({ type: "channel", linked_channel_id: 2 }))).toBeNull();
  expect(blockMediaUrl(column({ type: "tweet", url: "https://x.com/jack/status/20" }))).toBeNull();
  // An embed is warmed with a preconnect hint, not a fetch.
  expect(
    blockMediaUrl(column({ type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" })),
  ).toBeNull();
  expect(
    blockMediaUrl(column({ type: "spotify", url: "https://open.spotify.com/track/1" })),
  ).toBeNull();
  // A screenshot handed to a non-url block is ignored rather than fetched.
  expect(blockMediaUrl(column({ type: "pdf" }), shot())).toBeNull();
});

test("blockMediaUrl returns null for an image block with no media", () => {
  expect(blockMediaUrl(column({ type: "image", image: undefined }))).toBeNull();
});

test("blockPreconnectOrigins covers the embed hosts each iframe reaches for", () => {
  // i.ytimg.com serves the player's poster frame from a separate connection.
  expect(blockPreconnectOrigins(column({ type: "youtube" }))).toEqual([
    "https://www.youtube.com",
    "https://i.ytimg.com",
  ]);
  expect(blockPreconnectOrigins(column({ type: "spotify" }))).toEqual(["https://open.spotify.com"]);
});

test("blockPreconnectOrigins hints nothing for a block with no third-party embed", () => {
  for (const type of ["image", "url", "text", "channel", "pdf", "video", "tweet"] as const) {
    expect(blockPreconnectOrigins(column({ type }))).toEqual([]);
  }
  // The channel block links out but renders an avatar and a title, no iframe.
  expect(blockPreconnectOrigins(column({ type: "youtube_channel" }))).toEqual([]);
});

test("claimPreconnect hands out one <link> per origin per page load", () => {
  // Stepping along a row of YouTube blocks: the first block appends the links,
  // every block after it finds both origins already hinted.
  expect(claimPreconnect("https://a.test")).toBe(true);
  expect(claimPreconnect("https://a.test")).toBe(false);
  expect(claimPreconnect("https://a.test")).toBe(false);
  // Origins are tracked apart, so a Spotify block after a YouTube one still
  // gets its own hint.
  expect(claimPreconnect("https://b.test")).toBe(true);
  expect(claimPreconnect("https://b.test")).toBe(false);
  expect(claimPreconnect("https://a.test")).toBe(false);
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
