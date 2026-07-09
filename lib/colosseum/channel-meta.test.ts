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
  expect(meta.twitter?.card).toBe("summary");
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
