import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { createMedia, putBlob } from "./blob";
import { createChannel, updateChannel } from "./channel";
import { addChannelColumn, deleteColumn, getChannelColumns, uploadURLColumn } from "./column";
import { getScreenshot, upsertScreenshot } from "./screenshot-data";

beforeAll(async () => {
  await seed();
});

test("withLinkedChannels re-checks privacy: a linked channel gone private hides from all but its owner", async () => {
  // Bob owns a public channel; Alice links it into one of hers.
  const target = await createChannel({ title: "Linkable", private: false, owner_id: USERS.bob.id });
  const host = await createChannel({ title: "Host", private: false, owner_id: USERS.alice.id });
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
  await updateChannel(target.id, { title: "Linkable", private: true });

  // Non-owner viewers (and signed-out) now get no resolved display data...
  expect(await linked(USERS.alice.id)).toBeUndefined();
  expect(await linked(null)).toBeUndefined();
  // ...but Bob, the owner, still sees his own link's preview.
  expect((await linked(USERS.bob.id))?.title).toBe("Linkable");
});

test("deleting the last column for a URL GCs its cached screenshot; a shared one survives", async () => {
  const host = await createChannel({ title: "Links", private: false, owner_id: USERS.alice.id });
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
