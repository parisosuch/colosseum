import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { createMedia, getMedia, mediaIdFromUrl, putBlob } from "./blob";
import { createChannel, updateChannel } from "./channel";
import {
  addChannelColumn,
  copyColumn,
  deleteColumn,
  fillEmptyUrlColumnMeta,
  getChannelColumns,
  searchColumns,
  updateColumnTitle,
  uploadImageColumn,
  uploadURLColumn,
} from "./column";
import { getScreenshot, upsertScreenshot } from "./screenshot-data";

beforeAll(async () => {
  await seed();
});

test("copyColumn duplicates another user's block into your channel; the copy owns its media", async () => {
  // Bob owns the source block; Alice copies it into a channel of hers.
  const src = await createChannel({ title: "Src", access: "public", owner_id: USERS.bob.id });
  const dst = await createChannel({ title: "Dst", access: "public", owner_id: USERS.alice.id });

  // An image block backed by a real blob + media reference.
  const sha = await putBlob(Buffer.from("copy-test-bytes"), "image/png", USERS.bob.id);
  const srcUrl = await createMedia(sha, USERS.bob.id, "public");
  const source = {
    ...(await uploadImageColumn({ created_by: USERS.bob.id, channel_id: src.id, image: srcUrl })),
    title: "Pic",
    description: "desc",
    tags: ["a", "b"],
  };

  // The action mints a fresh media reference (owned by the copier) for the copy.
  const copyUrl = await createMedia(sha, USERS.alice.id, "public");
  expect(copyUrl).not.toBe(srcUrl);
  const copy = await copyColumn({
    source,
    channel_id: dst.id,
    created_by: USERS.alice.id,
    image: copyUrl,
  });

  expect(copy.id).not.toBe(source.id);
  expect(copy.channel_id).toBe(dst.id);
  expect(copy.created_by).toBe(USERS.alice.id); // the copier owns the copy
  expect(copy.type).toBe("image");
  expect(copy.title).toBe("Pic");
  expect(copy.description).toBe("desc");
  expect(copy.tags).toEqual(["a", "b"]);
  expect(copy.image).toBe(copyUrl);

  // Deleting the source drops its media reference, but the copy's own reference
  // (and the shared blob) survive — no dangling image.
  await deleteColumn(source.id);
  expect(await getMedia(mediaIdFromUrl(copyUrl)!)).not.toBeNull();
});

test("withLinkedChannels re-checks privacy: a linked channel gone private hides from all but its owner", async () => {
  // Bob owns a public channel; Alice links it into one of hers.
  const target = await createChannel({
    title: "Linkable",
    access: "public",
    owner_id: USERS.bob.id,
  });
  const host = await createChannel({ title: "Host", access: "public", owner_id: USERS.alice.id });
  const link = await addChannelColumn({
    created_by: USERS.alice.id,
    channel_id: host.id,
    linked_channel_id: target.id,
  });
  const linked = async (viewerId: string | null) =>
    (await getChannelColumns(host.id, {}, viewerId)).find((c) => c.id === link.id)?.linked_channel;

  // While public, the preview resolves for any viewer.
  expect((await linked(USERS.alice.id))?.title).toBe("Linkable");

  // Bob flips it private.
  await updateChannel(target.id, { title: "Linkable", access: "private" });

  // Non-owner viewers (and signed-out) now get no resolved display data...
  expect(await linked(USERS.alice.id)).toBeUndefined();
  expect(await linked(null)).toBeUndefined();
  // ...but Bob, the owner, still sees his own link's preview.
  expect((await linked(USERS.bob.id))?.title).toBe("Linkable");
});

test("deleting the last column for a URL GCs its cached screenshot; a shared one survives", async () => {
  const host = await createChannel({ title: "Links", access: "public", owner_id: USERS.alice.id });
  const url = "https://ponytail.example/gc-test";

  const a = await uploadURLColumn({ created_by: USERS.alice.id, channel_id: host.id, text: url });
  const b = await uploadURLColumn({ created_by: USERS.alice.id, channel_id: host.id, text: url });

  const sha = await putBlob(Buffer.from("fake-png-bytes"), "image/png", USERS.alice.id);
  const imageUrl = await createMedia(sha, USERS.alice.id, "public");
  await upsertScreenshot({ url, image_url: imageUrl, title: "t", description: "d" });

  // One of two columns gone → screenshot stays (still referenced by the other).
  await deleteColumn(a.id);
  expect((await getScreenshot(url))?.image_url).toBe(imageUrl);

  // Last one gone → the shared screenshot row and its media reference are GC'd.
  await deleteColumn(b.id);
  expect(await getScreenshot(url)).toBeNull();
});

test("fillEmptyUrlColumnMeta names blank URL blocks and leaves edited ones alone", async () => {
  const host = await createChannel({ title: "Named", access: "public", owner_id: USERS.alice.id });
  const url = "https://ponytail.example/og-title-test";

  // Two blocks on the same URL: one untouched, one the user already titled.
  const blank = await uploadURLColumn({
    created_by: USERS.alice.id,
    channel_id: host.id,
    text: url,
  });
  const edited = await uploadURLColumn({
    created_by: USERS.alice.id,
    channel_id: host.id,
    text: url,
  });
  await updateColumnTitle(edited.id, "My own name");

  // A block on a different URL must not be touched by this URL's metadata.
  const other = await uploadURLColumn({
    created_by: USERS.alice.id,
    channel_id: host.id,
    text: "https://ponytail.example/some-other-page",
  });

  await fillEmptyUrlColumnMeta(url, { title: "Page title", description: "Page description" });

  const byId = new Map((await getChannelColumns(host.id)).map((c) => [c.id, c]));
  expect(byId.get(blank.id)?.title).toBe("Page title");
  expect(byId.get(blank.id)?.description).toBe("Page description");
  expect(byId.get(edited.id)?.title).toBe("My own name");
  // The hand-titled block still had no description, so that half is filled.
  expect(byId.get(edited.id)?.description).toBe("Page description");
  expect(byId.get(other.id)?.title).toBeUndefined();

  // A second capture of the same URL doesn't overwrite what's already there.
  await fillEmptyUrlColumnMeta(url, { title: "Newer title", description: "Newer description" });
  const after = (await getChannelColumns(host.id)).find((c) => c.id === blank.id);
  expect(after?.title).toBe("Page title");
  expect(after?.description).toBe("Page description");
});

test("fillEmptyUrlColumnMeta makes a URL block findable by the page's title", async () => {
  const host = await createChannel({
    title: "Findable",
    access: "public",
    owner_id: USERS.alice.id,
  });
  const url = "https://ponytail.example/searchable-page";
  await uploadURLColumn({ created_by: USERS.alice.id, channel_id: host.id, text: url });

  // Before naming, the page's title matches nothing: search reads column rows,
  // never the screenshot cache.
  expect(await searchColumns(USERS.alice.id, "Quokka Weekly")).toEqual([]);

  await fillEmptyUrlColumnMeta(url, { title: "Quokka Weekly", description: "" });

  const hits = await searchColumns(USERS.alice.id, "Quokka Weekly");
  expect(hits.map((c) => c.url)).toContain(url);
});
