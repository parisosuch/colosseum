import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { createMedia, getMedia, mediaIdFromUrl, putBlob } from "./blob";
import { createChannel, updateChannel } from "./channel";
import {
  addChannelColumn,
  copyColumn,
  deleteColumn,
  getChannelColumns,
  updateColumnText,
  uploadImageColumn,
  uploadTextColumn,
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

test("a text block carries its markdown rendered to sanitized HTML", async () => {
  const ch = await createChannel({ title: "Notes", access: "public", owner_id: USERS.alice.id });
  const created = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "# Heading\n\n**bold** <script>alert('xss')</script>",
  });

  // The insert path renders it, so a just-created block is renderable without a
  // refetch (the grid prepends the returned block straight into its list).
  expect(created.html).toContain("<h1>Heading</h1>");
  expect(created.html).toContain("<strong>bold</strong>");
  // Sanitization runs server-side on the same pass; the script never survives
  // into the field the client passes to dangerouslySetInnerHTML.
  expect(created.html).not.toContain("<script");
  expect(created.html).not.toContain("alert(");

  // And the read path renders it identically.
  const [fetched] = await getChannelColumns(ch.id);
  expect(fetched.html).toBe(created.html);
});

test("only text blocks get html; other types leave it unset", async () => {
  const ch = await createChannel({ title: "Mixed", access: "public", owner_id: USERS.alice.id });
  await uploadURLColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "https://example.com/",
  });
  await uploadTextColumn({ created_by: USERS.alice.id, channel_id: ch.id, text: "a note" });

  const cols = await getChannelColumns(ch.id);
  const byType = new Map(cols.map((c) => [c.type, c]));
  expect(byType.get("text")?.html).toContain("<p>a note</p>");
  expect(byType.get("url")?.html).toBeUndefined();
});

test("paged fetches fill html too, so load-more blocks render like the first page", async () => {
  const ch = await createChannel({ title: "Paged", access: "public", owner_id: USERS.alice.id });
  for (const body of ["*first*", "*second*", "*third*"]) {
    await uploadTextColumn({ created_by: USERS.alice.id, channel_id: ch.id, text: body });
  }

  // The channel page server-renders page one and the client fetches the rest
  // through the same query, so every page has to arrive already rendered.
  const page1 = await getChannelColumns(ch.id, { sort: "oldest", limit: 2, offset: 0 });
  const page2 = await getChannelColumns(ch.id, { sort: "oldest", limit: 2, offset: 2 });
  expect(page1.map((c) => c.html)).toEqual(["<p><em>first</em></p>\n", "<p><em>second</em></p>\n"]);
  expect(page2.map((c) => c.html)).toEqual(["<p><em>third</em></p>\n"]);
});

test("updateColumnText returns the block with its html re-rendered from the new source", async () => {
  const ch = await createChannel({ title: "Edits", access: "public", owner_id: USERS.alice.id });
  const created = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "before",
  });

  // The modal swaps this straight into the block it already holds, so a stale
  // or unsanitized value here would land on a card.
  const updated = await updateColumnText(created.id, "## after\n\n<img src=x onerror=alert(1)>");
  expect(updated?.text).toBe("## after\n\n<img src=x onerror=alert(1)>");
  expect(updated?.html).toContain("<h2>after</h2>");
  expect(updated?.html).not.toContain("onerror");

  expect(await updateColumnText(-1, "gone")).toBeNull();
});
