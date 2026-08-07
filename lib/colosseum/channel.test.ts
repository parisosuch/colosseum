import { beforeAll, expect, test } from "bun:test";

import { BLOCKS, CHANNELS, seed, USERS } from "@/scripts/seed";
import { createMedia, mediaIdFromUrl, putBlob } from "./blob";
import {
  canContributeChannel,
  canReadMedia,
  channelReaders,
  createChannel,
  deleteChannel,
  getUserChannels,
  getUserPublicChannels,
  getVisibleUserChannels,
  searchChannels,
} from "./channel";
import { isChannelMember } from "./member";
import { searchColumns, uploadImageColumn, uploadURLColumn } from "./column";
import { getScreenshot, upsertScreenshot } from "./screenshot-data";

beforeAll(async () => {
  await seed();
});

test("deleting a channel GCs a URL block's cached screenshot when nothing else links it", async () => {
  const host = await createChannel({ title: "Doomed", access: "public", owner_id: USERS.alice.id });
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

test("getUserPublicChannels includes open channels (only private is hidden)", async () => {
  const titles = (await getUserPublicChannels(USERS.alice.id)).map((c) => c.title);
  expect(titles).toContain(CHANNELS.aliceOpen.title);
});

test("getVisibleUserChannels shows a private group to its members, not to outsiders", async () => {
  // Alice is a member of bob's private group, so she sees it on his profile...
  const asMember = (await getVisibleUserChannels(USERS.bob.id, USERS.alice.id)).map((c) => c.title);
  expect(asMember).toContain(CHANNELS.bobGroup.title);
  // ...a signed-out viewer sees only bob's public channels.
  const anon = (await getVisibleUserChannels(USERS.bob.id, null)).map((c) => c.title);
  expect(anon).toContain(CHANNELS.bobPhoto.title);
  expect(anon).not.toContain(CHANNELS.bobGroup.title);
});

test("searchChannels surfaces a private group to its members", async () => {
  // Alice (a member) finds bob's private group by title...
  expect(
    (await searchChannels(USERS.alice.id, CHANNELS.bobGroup.title)).map((c) => c.title),
  ).toContain(CHANNELS.bobGroup.title);
});

test("open channels let anyone contribute", async () => {
  const open = (await getUserPublicChannels(USERS.alice.id)).find(
    (c) => c.title === CHANNELS.aliceOpen.title,
  )!;
  expect(canContributeChannel(open, USERS.bob.id, false)).toBe(true);
});

test("a public channel takes members: non-members can't add, invited members can", async () => {
  const publicCh = (await getUserPublicChannels(USERS.alice.id)).find(
    (c) => c.title === CHANNELS.aliceDesign.title,
  )!;
  // Anyone may read it, but a non-member (not the owner) may not add...
  expect(canContributeChannel(publicCh, USERS.bob.id, false)).toBe(false);
  // ...while an invited member may.
  expect(canContributeChannel(publicCh, USERS.bob.id, true)).toBe(true);
  // The owner always may.
  expect(canContributeChannel(publicCh, USERS.alice.id, false)).toBe(true);
});

test("a private group member can read and contribute; the membership row backs it", async () => {
  const [group] = await getVisibleUserChannels(USERS.bob.id, USERS.alice.id).then((cs) =>
    cs.filter((c) => c.title === CHANNELS.bobGroup.title),
  );
  const aliceIsMember = await isChannelMember(group.id, USERS.alice.id);
  expect(aliceIsMember).toBe(true);
  expect(canContributeChannel(group, USERS.alice.id, aliceIsMember)).toBe(true);
  // A non-member (no session / not invited) can neither read nor contribute.
  expect(canContributeChannel(group, USERS.bob.id, false)).toBe(true); // owner
});

test("channelReaders keeps a private channel's owner and members, drops outsiders", async () => {
  const [group] = await getVisibleUserChannels(USERS.bob.id, USERS.alice.id).then((cs) =>
    cs.filter((c) => c.title === CHANNELS.bobGroup.title),
  );
  const outsider = "99999999-9999-4999-8999-999999999999";
  // A comment notification names the block and its channel and quotes the body,
  // and a mention resolves any handle — so the recipient list is filtered here
  // before anything is written.
  expect(await channelReaders(group, [USERS.bob.id, USERS.alice.id, outsider])).toEqual([
    USERS.bob.id,
    USERS.alice.id,
  ]);

  // A public channel is readable by anyone, so nobody is dropped.
  const [design] = await getUserChannels(USERS.alice.id).then((cs) =>
    cs.filter((c) => c.title === CHANNELS.aliceDesign.title),
  );
  expect(await channelReaders(design, [USERS.bob.id, outsider])).toEqual([USERS.bob.id, outsider]);
});

test("canReadMedia lets a private channel's members view its images, not outsiders", async () => {
  const [group] = await getVisibleUserChannels(USERS.bob.id, USERS.alice.id).then((cs) =>
    cs.filter((c) => c.title === CHANNELS.bobGroup.title),
  );
  // A private image uploaded into bob's private group.
  const sha = await putBlob(Buffer.from("private-group-image"), "image/png", USERS.bob.id);
  const url = await createMedia(sha, USERS.bob.id, "private");
  await uploadImageColumn({ created_by: USERS.bob.id, channel_id: group.id, image: url });
  const mediaId = mediaIdFromUrl(url)!;

  expect(await canReadMedia(mediaId, USERS.bob.id)).toBe(true); // owner
  expect(await canReadMedia(mediaId, USERS.alice.id)).toBe(true); // member — the bug
  // An outsider (not the owner, not a member) and a signed-out viewer cannot.
  expect(await canReadMedia(mediaId, "99999999-9999-4999-8999-999999999999")).toBe(false);
  expect(await canReadMedia(mediaId, null)).toBe(false);
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

test("searchColumns surfaces a private group's blocks to its members", async () => {
  // Alice is a member of bob's private group, so its blocks are searchable to her.
  expect((await searchColumns(USERS.alice.id, BLOCKS.bobGroup)).map((c) => c.title)).toContain(
    BLOCKS.bobGroup,
  );
});
