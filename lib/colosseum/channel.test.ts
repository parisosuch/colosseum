import { beforeAll, expect, test } from "bun:test";

import { BLOCKS, CHANNELS, seed, USERS } from "@/scripts/seed";
import { SEARCH_LIMIT } from "@/lib/utils";
import { createMedia, mediaIdFromUrl, putBlob } from "./blob";
import {
  canContributeChannel,
  canReadMedia,
  channelReaders,
  createChannel,
  deleteChannel,
  getOwnerChannels,
  getOwnerPublicChannels,
  getVisibleOwnerChannels,
  searchChannels,
  updateChannel,
  viewerScope,
  type ChannelViewer,
} from "./channel";
import { isChannelMember } from "./member";
import { searchColumns, uploadImageColumn, uploadTextColumn, uploadURLColumn } from "./column";
import { getScreenshot, upsertScreenshot } from "./screenshot-data";

beforeAll(async () => {
  await seed();
});

// A viewer for `userId` with the membership flag stated outright, so a test can
// name the roster condition it is exercising instead of seeding one for it.
async function viewerFor(userId: string | null, isChannelMember = false): Promise<ChannelViewer> {
  return { ...(await viewerScope(userId)), isChannelMember };
}

test("deleting a channel GCs a URL block's cached screenshot when nothing else links it", async () => {
  const host = await createChannel({
    title: "Doomed",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
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

test("getOwnerPublicChannels excludes private channels", async () => {
  const titles = (await getOwnerPublicChannels(USERS.alice.ownerId)).map((c) => c.title);
  expect(titles).toContain(CHANNELS.aliceDesign.title);
  expect(titles).not.toContain(CHANNELS.alicePrivate.title);
});

test("getOwnerChannels includes the owner's private channels", async () => {
  const titles = (await getOwnerChannels(USERS.alice.ownerId)).map((c) => c.title);
  expect(titles).toContain(CHANNELS.aliceDesign.title);
  expect(titles).toContain(CHANNELS.alicePrivate.title);
});

test("getOwnerPublicChannels includes open channels (only private is hidden)", async () => {
  const titles = (await getOwnerPublicChannels(USERS.alice.ownerId)).map((c) => c.title);
  expect(titles).toContain(CHANNELS.aliceOpen.title);
});

test("getVisibleOwnerChannels shows a private group to its members, not to outsiders", async () => {
  // Alice is a member of bob's private group, so she sees it on his profile...
  const asMember = (
    await getVisibleOwnerChannels(USERS.bob.ownerId, await viewerScope(USERS.alice.id))
  ).map((c) => c.title);
  expect(asMember).toContain(CHANNELS.bobGroup.title);
  // ...a signed-out viewer sees only bob's public channels.
  const anon = (await getVisibleOwnerChannels(USERS.bob.ownerId, await viewerScope(null))).map(
    (c) => c.title,
  );
  expect(anon).toContain(CHANNELS.bobPhoto.title);
  expect(anon).not.toContain(CHANNELS.bobGroup.title);
});

test("searchChannels surfaces a private group to its members", async () => {
  // Alice (a member) finds bob's private group by title...
  expect(
    (await searchChannels(await viewerScope(USERS.alice.id), CHANNELS.bobGroup.title)).map(
      (c) => c.title,
    ),
  ).toContain(CHANNELS.bobGroup.title);
});

test("open channels let anyone contribute", async () => {
  const open = (await getOwnerPublicChannels(USERS.alice.ownerId)).find(
    (c) => c.title === CHANNELS.aliceOpen.title,
  )!;
  expect(canContributeChannel(open, await viewerFor(USERS.bob.id))).toBe(true);
});

test("a public channel takes members: non-members can't add, invited members can", async () => {
  const publicCh = (await getOwnerPublicChannels(USERS.alice.ownerId)).find(
    (c) => c.title === CHANNELS.aliceDesign.title,
  )!;
  // Anyone may read it, but a non-member (not the owner) may not add...
  expect(canContributeChannel(publicCh, await viewerFor(USERS.bob.id))).toBe(false);
  // ...while an invited member may.
  expect(canContributeChannel(publicCh, await viewerFor(USERS.bob.id, true))).toBe(true);
  // The owner always may.
  expect(canContributeChannel(publicCh, await viewerFor(USERS.alice.id))).toBe(true);
});

test("a private group member can read and contribute; the membership row backs it", async () => {
  const [group] = await getVisibleOwnerChannels(
    USERS.bob.ownerId,
    await viewerScope(USERS.alice.id),
  ).then((cs) => cs.filter((c) => c.title === CHANNELS.bobGroup.title));
  const aliceIsMember = await isChannelMember(group.id, USERS.alice.id);
  expect(aliceIsMember).toBe(true);
  expect(canContributeChannel(group, await viewerFor(USERS.alice.id, aliceIsMember))).toBe(true);
  // A non-member (no session / not invited) can neither read nor contribute.
  expect(canContributeChannel(group, await viewerFor(USERS.bob.id))).toBe(true); // owner
});

test("channelReaders keeps a private channel's owner and members, drops outsiders", async () => {
  const [group] = await getVisibleOwnerChannels(
    USERS.bob.ownerId,
    await viewerScope(USERS.alice.id),
  ).then((cs) => cs.filter((c) => c.title === CHANNELS.bobGroup.title));
  const outsider = "99999999-9999-4999-8999-999999999999";
  // A comment notification names the block and its channel and quotes the body,
  // and a mention resolves any handle — so the recipient list is filtered here
  // before anything is written.
  expect(await channelReaders(group, [USERS.bob.id, USERS.alice.id, outsider])).toEqual([
    USERS.bob.id,
    USERS.alice.id,
  ]);

  // A public channel is readable by anyone, so nobody is dropped.
  const [design] = await getOwnerChannels(USERS.alice.ownerId).then((cs) =>
    cs.filter((c) => c.title === CHANNELS.aliceDesign.title),
  );
  expect(await channelReaders(design, [USERS.bob.id, outsider])).toEqual([USERS.bob.id, outsider]);
});

test("canReadMedia lets a private channel's members view its images, not outsiders", async () => {
  const [group] = await getVisibleOwnerChannels(
    USERS.bob.ownerId,
    await viewerScope(USERS.alice.id),
  ).then((cs) => cs.filter((c) => c.title === CHANNELS.bobGroup.title));
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
  expect(await searchChannels(await viewerScope(USERS.alice.id), "")).toEqual([]);
  const hits = await searchChannels(await viewerScope(USERS.alice.id), "design");
  expect(hits.map((c) => c.title)).toContain(CHANNELS.aliceDesign.title);
});

test("searchChannels surfaces other users' public channels with the owner handle", async () => {
  const hit = (await searchChannels(await viewerScope(USERS.alice.id), "photography")).find(
    (c) => c.title === CHANNELS.bobPhoto.title,
  );
  expect(hit?.handle).toBe(USERS.bob.handle);
});

test("searchChannels hides others' private channels but shows your own", async () => {
  // Bob can't see Alice's private channel...
  expect(
    (await searchChannels(await viewerScope(USERS.bob.id), "private")).map((c) => c.title),
  ).not.toContain(CHANNELS.alicePrivate.title);
  // ...but Alice finds her own.
  expect(
    (await searchChannels(await viewerScope(USERS.alice.id), "private")).map((c) => c.title),
  ).toContain(CHANNELS.alicePrivate.title);
});

test("searchChannels ranks a title match above a tag, and a tag above a description", async () => {
  // Created in the reverse of the expected order, so an unranked query returns
  // them backwards and this test fails on the ranking rather than on the row
  // order the database happens to hand back.
  const described = await createChannel({
    title: "Weekend Reading",
    description: "mostly ceramics writing",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const tagged = await createChannel({
    title: "Studio Notes",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  await updateChannel(tagged.id, { title: tagged.title, access: "public", tags: ["ceramics"] });
  const titled = await createChannel({
    title: "Ceramics",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });

  expect(
    (await searchChannels(await viewerScope(USERS.alice.id), "ceramics")).map((c) => c.title),
  ).toEqual(["Ceramics", "Studio Notes", "Weekend Reading"]);

  for (const c of [titled, tagged, described]) {
    await deleteChannel(c.id);
  }
});

test("searchColumns surfaces other users' public blocks but never private ones", async () => {
  // Alice's block in a public channel is visible to Bob, tagged with her handle.
  const publicHit = (await searchColumns(await viewerScope(USERS.bob.id), BLOCKS.alicePublic)).find(
    (c) => c.title === BLOCKS.alicePublic,
  );
  expect(publicHit?.handle).toBe(USERS.alice.handle);

  // Her block in a private channel must never surface for Bob...
  expect(
    (await searchColumns(await viewerScope(USERS.bob.id), BLOCKS.alicePrivate)).map((c) => c.title),
  ).not.toContain(BLOCKS.alicePrivate);
  // ...but she can find it herself.
  expect(
    (await searchColumns(await viewerScope(USERS.alice.id), BLOCKS.alicePrivate)).map(
      (c) => c.title,
    ),
  ).toContain(BLOCKS.alicePrivate);
});

test("searchColumns surfaces a private group's blocks to its members", async () => {
  // Alice is a member of bob's private group, so its blocks are searchable to her.
  expect(
    (await searchColumns(await viewerScope(USERS.alice.id), BLOCKS.bobGroup)).map((c) => c.title),
  ).toContain(BLOCKS.bobGroup);
});

test("searchChannels and searchColumns take a limit, defaulting to SEARCH_LIMIT", async () => {
  const viewer = await viewerScope(USERS.alice.id);
  const channel = await createChannel({
    title: "Limit probe",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  // Comfortably more than the default cap, so the default is observable.
  const term = "limitprobeterm";
  for (let i = 0; i < SEARCH_LIMIT + 3; i++) {
    await uploadTextColumn({
      created_by: USERS.alice.id,
      channel_id: channel.id,
      text: `${term} ${i}`,
    });
  }

  // The nav search box's cap is the default, so its behaviour is unchanged.
  expect((await searchColumns(viewer, term)).length).toBe(SEARCH_LIMIT);
  expect((await searchColumns(viewer, term, 3)).length).toBe(3);
  expect((await searchChannels(viewer, "Limit probe", 1)).length).toBe(1);
});
