import { beforeAll, expect, test } from "bun:test";

import { CHANNELS, seed, USERS } from "@/scripts/seed";
import { getUserChannels, getUserPublicChannels, searchUserChannels } from "./channel";

beforeAll(async () => {
  await seed();
});

test("getUserPublicChannels excludes private channels", async () => {
  const titles = (await getUserPublicChannels(USERS.alice.id)).map((c) => c.title);
  expect(titles).toContain(CHANNELS.aliceDesign.title);
  expect(titles).not.toContain(CHANNELS.alicePrivate.title);
});

test("getUserChannels includes the owner's private channels", async () => {
  const titles = (await getUserChannels(USERS.alice.id)).map((c) => c.title);
  expect(titles).toContain(CHANNELS.aliceDesign.title);
  expect(titles).toContain(CHANNELS.alicePrivate.title);
});

test("searchUserChannels matches by title and returns nothing for an empty query", async () => {
  expect(await searchUserChannels(USERS.alice.id, "")).toEqual([]);
  const hits = await searchUserChannels(USERS.alice.id, "design");
  expect(hits.map((c) => c.title)).toContain(CHANNELS.aliceDesign.title);
});

test("searchUserChannels is scoped to the caller", async () => {
  // Bob's "Photography" must never surface in Alice's search.
  const hits = await searchUserChannels(USERS.alice.id, "photography");
  expect(hits.map((c) => c.title)).not.toContain(CHANNELS.bobPhoto.title);
});
