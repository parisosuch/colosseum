import { expect, test } from "bun:test";

import type { Channel } from "./channel";
import { channelPreviewMeta } from "./channel-meta";

const channel = (over: Partial<Channel>): Channel => ({
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

test("public channel gets a rich preview with name, owner, and description", () => {
  const meta = channelPreviewMeta(channel({}), "paris");
  expect(meta.title).toBe("Design Inspiration · Colosseum");
  expect(meta.description).toBe("moodboards and type — a channel by @paris on Colosseum");
  expect(meta.openGraph?.url).toBe("/paris/42");
  // @ts-expect-error twitter card type is a loose union in next's Metadata
  expect(meta.twitter?.card).toBe("summary_large_image");
  // No picture from inside the channel, so the site card stands in — Next stops
  // merging its own default once a route sets openGraph itself.
  // @ts-expect-error next types openGraph.images as a loose union
  expect(meta.openGraph?.images?.[0]?.url).toBe("/opengraph-image.png");
});

test("channel without a description still names the owner", () => {
  const meta = channelPreviewMeta(channel({ description: undefined }), "paris");
  expect(meta.description).toBe("A channel by @paris on Colosseum");
});

test("private channel does not leak its name/description/owner", () => {
  const meta = channelPreviewMeta(channel({ access: "private", private: true }), "paris");
  expect(meta).toEqual({ title: "Colosseum" });
});

test("missing channel returns generic metadata", () => {
  expect(channelPreviewMeta(null, "paris")).toEqual({ title: "Colosseum" });
});

test("a channel with a picture from inside it shares as a large card", () => {
  const meta = channelPreviewMeta(channel({}), "paris", "/api/media/abc");
  // @ts-expect-error next types openGraph.images as a loose union
  expect(meta.openGraph?.images?.[0]?.url).toBe("/api/media/abc");
  // @ts-expect-error twitter card type is a loose union in next's Metadata
  expect(meta.twitter?.card).toBe("summary_large_image");
});

test("a private channel gives nothing away, image or not", () => {
  const meta = channelPreviewMeta(
    channel({ access: "private", private: true }),
    "paris",
    "/api/media/abc",
  );
  expect(meta).toEqual({ title: "Colosseum" });
});
