import { expect, test } from "bun:test";

import type { Channel } from "./channel";
import type { Column } from "./column";
import { blockPreviewMeta, blockShareImage } from "./block-meta";

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: 42,
  created_at: "2026-01-01T00:00:00Z",
  title: "Design Inspiration",
  description: "moodboards and type",
  access: "public",
  private: false,
  owner_id: "u1",
  tags: [],
  ...over,
});

const block = (over: Partial<Column> = {}): Column => ({
  id: 7,
  created_at: "2026-01-01T00:00:00Z",
  type: "image",
  created_by: "u1",
  channel_id: 42,
  tags: [],
  ...over,
});

const meta = (over: Partial<Parameters<typeof blockPreviewMeta>[0]> = {}) =>
  blockPreviewMeta({ column: block(), channel: channel(), handle: "paris", ...over });

test("an image block shares as a large card carrying the image itself", () => {
  const m = meta({ column: block({ title: "Quokka", image: "/api/media/abc" }) });
  expect(m.title).toBe("Quokka · Colosseum");
  expect(m.openGraph?.url).toBe("/paris/42/7");
  // @ts-expect-error next types openGraph.images as a loose union
  expect(m.openGraph?.images?.[0]?.url).toBe("/api/media/abc");
  // @ts-expect-error twitter card type is a loose union in next's Metadata
  expect(m.twitter?.card).toBe("summary_large_image");
});

test("a URL block shares its cached preview and the captured page description", () => {
  const m = meta({
    column: block({ type: "url", url: "https://example.test/x" }),
    previewUrl: "/api/media/shot",
    previewDescription: "A page about things",
  });
  expect(m.description).toBe("A page about things");
  // @ts-expect-error next types openGraph.images as a loose union
  expect(m.openGraph?.images?.[0]?.url).toBe("/api/media/shot");
});

test("a block's own description wins over the captured one", () => {
  const m = meta({
    column: block({ type: "url", url: "https://example.test/x", description: "Mine" }),
    previewDescription: "Theirs",
  });
  expect(m.description).toBe("Mine");
});

test("with no description anywhere, the card says where the block lives", () => {
  const m = meta({ column: block({ type: "text", text: "" }) });
  expect(m.description).toBe("In Design Inspiration, a channel by @paris on Colosseum");
});

test("a block in a private channel gets a title and nothing to unfurl", () => {
  const m = meta({
    column: block({ title: "Secret", image: "/api/media/abc" }),
    channel: channel({ access: "private", private: true }),
  });
  expect(m.title).toBe("Secret · Colosseum");
  expect(m.openGraph).toBeUndefined();
  expect(m.description).toBeUndefined();
});

test("blocks with no picture of their own fall back to the site card, not to nothing", () => {
  // pdf and video fill `image` with the file itself, which no client can render.
  // Setting openGraph at all stops Next merging its file-convention default, so
  // the fallback has to be explicit or these share with no image.
  for (const type of ["pdf", "video", "text", "channel"] as const) {
    const m = meta({ column: block({ type, image: "/api/media/not-an-image" }) });
    // @ts-expect-error next types openGraph.images as a loose union
    expect(m.openGraph?.images?.[0]?.url).toBe("/opengraph-image.png");
    // @ts-expect-error twitter card type is a loose union in next's Metadata
    expect(m.twitter?.card).toBe("summary_large_image");
  }
});

test("blockShareImage picks per type", () => {
  expect(blockShareImage(block({ type: "image", image: "/api/media/a" }), null)?.url).toBe(
    "/api/media/a",
  );
  expect(blockShareImage(block({ type: "url" }), "/api/media/shot")).toEqual({
    url: "/api/media/shot",
    width: 1200,
    height: 1200,
  });
  expect(
    blockShareImage(block({ type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" }), null)?.url,
  ).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  // A URL block with no capture yet has nothing to show.
  expect(blockShareImage(block({ type: "url" }), null)).toBeNull();
});
