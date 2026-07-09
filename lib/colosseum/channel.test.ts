import { beforeAll, expect, test } from "bun:test";

import { BLOCKS, CHANNELS, seed, USERS } from "@/scripts/seed";
import { createMedia, putBlob } from "./blob";
import {
  createChannel,
  deleteChannel,
  getUserChannels,
  getUserPublicChannels,
  searchChannels,
} from "./channel";
import { searchColumns, uploadURLColumn } from "./column";
import { getScreenshot, upsertScreenshot } from "./screenshot-data";

beforeAll(async () => {
  await seed();
});

test("deleting a channel GCs a URL block's cached screenshot when nothing else links it", async () => {
  const host = await createChannel({ title: "Doomed", private: false, owner_id: USERS.alice.id });
  const url = "https://ponytail.example/channel-delete";
  await uploadURLColumn({ created_by: USERS.alice.id, channel_id: host.id, text: url });

  const sha = await putBlob(Buffer.from("fake-png-bytes"), "image/png", USERS.alice.id);
  await upsertScreenshot({
    url,
    image_url: await createMedia(sha, USERS.alice.id, "public"),
    title: "t",
    description: "d",
  });

  // The cascade removes the URL column without calling deleteColumn; the shared
  // screenshot must still be GC'd since no surviving column references the URL.
  await deleteChannel(host.id);
  expect(await getScreenshot(url)).toBeNull();
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

test("searchChannels matches by title and returns nothing for an empty query", async () => {
  expect(await searchChannels(USERS.alice.id, "")).toEqual([]);
  const hits = await searchChannels(USERS.alice.id, "design");
  expect(hits.map((c) => c.title)).toContain(CHANNELS.aliceDesign.title);
});

test("searchChannels surfaces other users' public channels with the owner handle", async () => {
  const hit = (await searchChannels(USERS.alice.id, "photography")).find(
    (c) => c.title === CHANNELS.bobPhoto.title,
  );
  expect(hit?.handle).toBe(USERS.bob.handle);
});

test("searchChannels hides others' private channels but shows your own", async () => {
  // Bob can't see Alice's private channel...
  expect((await searchChannels(USERS.bob.id, "private")).map((c) => c.title)).not.toContain(
    CHANNELS.alicePrivate.title,
  );
  // ...but Alice finds her own.
  expect((await searchChannels(USERS.alice.id, "private")).map((c) => c.title)).toContain(
    CHANNELS.alicePrivate.title,
  );
});

test("searchColumns surfaces other users' public blocks but never private ones", async () => {
  // Alice's block in a public channel is visible to Bob, tagged with her handle.
  const publicHit = (await searchColumns(USERS.bob.id, BLOCKS.alicePublic)).find(
    (c) => c.title === BLOCKS.alicePublic,
  );
  expect(publicHit?.handle).toBe(USERS.alice.handle);

  // Her block in a private channel must never surface for Bob...
  expect(
    (await searchColumns(USERS.bob.id, BLOCKS.alicePrivate)).map((c) => c.title),
  ).not.toContain(BLOCKS.alicePrivate);
  // ...but she can find it herself.
  expect((await searchColumns(USERS.alice.id, BLOCKS.alicePrivate)).map((c) => c.title)).toContain(
    BLOCKS.alicePrivate,
  );
});
