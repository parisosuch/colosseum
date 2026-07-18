import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { blockLabel, getActivityFeed, type ActivityItem } from "./activity";
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

test("image and channel fall back to a noun", () => {
  expect(blockLabel(b({ type: "image" }))).toBe("an image");
  expect(blockLabel(b({ type: "channel" }))).toBe("a channel");
});

test("getActivityFeed: private-channel blocks reach the owner and members, not outsiders", async () => {
  const hasBlock = (items: ActivityItem[], id: number) =>
    items.some((i) => i.kind === "block" && i.column?.id === id);

  // Bob owns a private channel that Alice is a member of.
  const shared = await createChannel({ title: "Shared", access: "private", owner_id: USERS.bob.id });
  await addChannelMemberByHandle(shared.id, USERS.alice.handle);
  const sharedBlock = await uploadURLColumn({
    created_by: USERS.bob.id,
    channel_id: shared.id,
    text: "https://ponytail.example/explore-306-shared",
  });

  // Bob owns another private channel Alice is NOT in.
  const secret = await createChannel({ title: "Secret", access: "private", owner_id: USERS.bob.id });
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
