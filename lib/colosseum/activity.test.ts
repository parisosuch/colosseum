import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { blockLabel, getActivityFeed, groupActivity, type ActivityItem } from "./activity";
import { createChannel } from "./channel";
import { uploadURLColumn } from "./column";
import { addChannelMemberByHandle } from "./member";

beforeAll(async () => {
  await seed();
});

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

test("getActivityFeed: a member's block carries the channel owner's handle", async () => {
  // Bob owns a public channel; Alice is a member and adds the block. The feed
  // attributes it to Alice but the channel still lives under Bob.
  const channel = await createChannel({
    title: "Bob's public channel",
    access: "public",
    owner_id: USERS.bob.id,
  });
  await addChannelMemberByHandle(channel.id, USERS.alice.handle);
  const block = await uploadURLColumn({
    created_by: USERS.alice.id,
    channel_id: channel.id,
    text: "https://ponytail.example/explore-408-member-add",
  });

  const feed = await getActivityFeed(null, 200);
  const item = feed.find((i) => i.kind === "block" && i.column?.id === block.id);

  expect(item?.handle).toBe(USERS.alice.handle);
  expect(item?.channelHandle).toBe(USERS.bob.handle);
});

test("getActivityFeed: private-channel blocks reach the owner and members, not outsiders", async () => {
  const hasBlock = (items: ActivityItem[], id: number) =>
    items.some((i) => i.kind === "block" && i.column?.id === id);

  // Bob owns a private channel that Alice is a member of.
  const shared = await createChannel({
    title: "Shared",
    access: "private",
    owner_id: USERS.bob.id,
  });
  await addChannelMemberByHandle(shared.id, USERS.alice.handle);
  const sharedBlock = await uploadURLColumn({
    created_by: USERS.bob.id,
    channel_id: shared.id,
    text: "https://ponytail.example/explore-306-shared",
  });

  // Bob owns another private channel Alice is NOT in.
  const secret = await createChannel({
    title: "Secret",
    access: "private",
    owner_id: USERS.bob.id,
  });
  const secretBlock = await uploadURLColumn({
    created_by: USERS.bob.id,
    channel_id: secret.id,
    text: "https://ponytail.example/explore-306-secret",
  });

  const [bobFeed, aliceFeed, anonFeed] = await Promise.all([
    getActivityFeed(USERS.bob.id, 200),
    getActivityFeed(USERS.alice.id, 200),
    getActivityFeed(null, 200),
  ]);

  // Owner sees both his private blocks.
  expect(hasBlock(bobFeed, sharedBlock.id)).toBe(true);
  expect(hasBlock(bobFeed, secretBlock.id)).toBe(true);
  // Member sees the channel she's in — and not the one she isn't.
  expect(hasBlock(aliceFeed, sharedBlock.id)).toBe(true);
  expect(hasBlock(aliceFeed, secretBlock.id)).toBe(false);
  // Signed-out outsiders never see private blocks.
  expect(hasBlock(anonFeed, sharedBlock.id)).toBe(false);
  expect(hasBlock(anonFeed, secretBlock.id)).toBe(false);
});

const add = (handle: string, channelId: number, id: number, type = "image"): ActivityItem => ({
  kind: "block",
  at: new Date(id * 1000).toISOString(),
  handle,
  channelId,
  channelTitle: `c${channelId}`,
  column: { id, type } as ActivityItem["column"],
});

test("groupActivity: consecutive adds by one person to one channel collapse", () => {
  const groups = groupActivity([
    add("alice", 1, 1),
    add("alice", 1, 2),
    add("alice", 1, 3),
    // A different channel, then a different actor, then back to the first pair.
    add("alice", 2, 4),
    add("bob", 2, 5),
    { kind: "user", at: "2020-01-01T00:00:00.000Z", handle: "carol" },
    add("alice", 1, 6),
  ]);

  expect(groups.map((g) => g.length)).toEqual([3, 1, 1, 1, 1]);
  expect(groups[0].map((i) => i.column!.id)).toEqual([1, 2, 3]);
  expect(groups[4][0].column!.id).toBe(6);
});

test("groupActivity: a channel-column never joins a group", () => {
  const groups = groupActivity([
    add("alice", 1, 1),
    add("alice", 1, 2, "channel"),
    add("alice", 1, 3),
  ]);
  expect(groups.map((g) => g.length)).toEqual([1, 1, 1]);
});
