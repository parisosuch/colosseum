import { beforeAll, expect, test } from "bun:test";
import { NextResponse } from "next/server";

import { seed, USERS } from "@/scripts/seed";
import {
  attachPreview,
  attachPreviews,
  copyBlock,
  leaveChannel,
  moveBlock,
  reorderBlock,
} from "./api-auth";
import { createMedia, putBlob } from "./blob";
import { createChannel } from "./channel";
import {
  Column,
  getChannelColumns,
  uploadImageColumn,
  uploadTextColumn,
  uploadURLColumn,
} from "./column";
import { addChannelMemberByHandle, isChannelMember } from "./member";
import { getScreenshot, upsertScreenshot } from "./screenshot-data";

beforeAll(async () => {
  await seed();
});

// moveBlock returns either the moved block or a denial NextResponse; these pull
// the status + message out of the denial the way the REST API and the MCP tool
// (via denialToError) do.
async function denial(result: Column | NextResponse): Promise<{ status: number; error: string }> {
  expect(result).toBeInstanceOf(NextResponse);
  const res = result as NextResponse;
  const body = (await res.json()) as { error?: string };
  return { status: res.status, error: body.error ?? "" };
}

test("moveBlock reassigns the block, keeping its id, created_at, and screenshot", async () => {
  const src = await createChannel({
    title: "From",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const dst = await createChannel({
    title: "To",
    access: "private",
    owned_by: USERS.alice.ownerId,
  });

  const url = "https://ponytail.example/move-test";
  const block = await uploadURLColumn({
    created_by: USERS.alice.id,
    channel_id: src.id,
    text: url,
  });

  // A url block's preview lives in the shared per-URL screenshot cache, so the
  // move must leave it resolvable — that's the thing create-then-delete loses.
  const sha = await putBlob(Buffer.from("move-test-bytes"), "image/png", USERS.alice.id);
  const imageUrl = await createMedia(sha, USERS.alice.id, "public");
  await upsertScreenshot({ url, image_url: imageUrl, title: "t", description: "d" });

  const moved = await moveBlock(block.id, dst.id, USERS.alice.id);
  expect(moved).not.toBeInstanceOf(NextResponse);
  const result = moved as Column;

  expect(result.id).toBe(block.id);
  expect(result.created_at).toBe(block.created_at);
  expect(result.created_by).toBe(block.created_by);
  expect(result.url).toBe(url);
  expect(result.channel_id).toBe(dst.id);

  expect((await getChannelColumns(src.id)).map((c) => c.id)).not.toContain(block.id);
  expect((await getChannelColumns(dst.id)).map((c) => c.id)).toContain(block.id);
  expect((await getScreenshot(url))?.image_url).toBe(imageUrl);
});

test("moveBlock into the block's current channel is a no-op that returns it unchanged", async () => {
  const ch = await createChannel({
    title: "Stay",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "here already",
  });

  const moved = await moveBlock(block.id, ch.id, USERS.alice.id);
  expect((moved as Column).channel_id).toBe(ch.id);
  expect((await getChannelColumns(ch.id)).map((c) => c.id)).toEqual([block.id]);
});

test("moveBlock refuses a source channel the caller does not own", async () => {
  // Bob's channel is public, so Alice can read it — but not move things out.
  const src = await createChannel({
    title: "Bob's",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const dst = await createChannel({
    title: "Alice's",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: src.id,
    text: "bob's block",
  });

  const { status, error } = await denial(await moveBlock(block.id, dst.id, USERS.alice.id));
  expect(status).toBe(403);
  expect(error).toBe("You do not have permission to modify this resource.");
  expect((await getChannelColumns(src.id)).map((c) => c.id)).toContain(block.id);
});

test("moveBlock refuses a destination the caller does not own", async () => {
  const src = await createChannel({
    title: "Mine",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const dst = await createChannel({
    title: "Theirs",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: src.id,
    text: "alice's block",
  });

  const { status, error } = await denial(await moveBlock(block.id, dst.id, USERS.alice.id));
  expect(status).toBe(403);
  expect(error).toBe("You do not have permission to modify this resource.");
  expect((await getChannelColumns(src.id)).map((c) => c.id)).toContain(block.id);
});

test("moveBlock 404s on a private destination, so it never confirms one exists", async () => {
  const src = await createChannel({
    title: "Src",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const dst = await createChannel({
    title: "Hidden",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: src.id,
    text: "block",
  });

  expect(await denial(await moveBlock(block.id, dst.id, USERS.alice.id))).toEqual({
    status: 404,
    error: "Not found.",
  });
});

test("moveBlock 404s on a missing block or a missing destination channel", async () => {
  const src = await createChannel({
    title: "Src",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: src.id,
    text: "block",
  });

  expect(await denial(await moveBlock(999_999_999, src.id, USERS.alice.id))).toEqual({
    status: 404,
    error: "Not found.",
  });
  expect(await denial(await moveBlock(block.id, 999_999_999, USERS.alice.id))).toEqual({
    status: 404,
    error: "Not found.",
  });
});

test("copyBlock leaves the original and gives the copy its own media", async () => {
  const src = await createChannel({
    title: "Source",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const dst = await createChannel({
    title: "Target",
    access: "private",
    owned_by: USERS.alice.ownerId,
  });

  const sha = await putBlob(Buffer.from("copy-test-bytes"), "image/png", USERS.bob.id);
  const image = await createMedia(sha, USERS.bob.id, "public");
  const source = await uploadImageColumn({
    created_by: USERS.bob.id,
    channel_id: src.id,
    image,
  });

  // Alice can only read Bob's channel, which is all copying needs.
  const copy = (await copyBlock(source.id, dst.id, USERS.alice.id)) as Column;
  expect(copy).not.toBeInstanceOf(NextResponse);

  expect(copy.id).not.toBe(source.id);
  expect(copy.channel_id).toBe(dst.id);
  expect(copy.created_by).toBe(USERS.alice.id);
  // A fresh media reference, not the source's — otherwise deleting either block
  // would dangle the other's image, and a copy into a private channel would
  // keep pointing at public media.
  expect(copy.image).not.toBe(source.image);
  // The original stays where it was.
  expect((await getChannelColumns(src.id)).map((c) => c.id)).toContain(source.id);
});

test("copyBlock needs only read on the source, but contribute on the target", async () => {
  const src = await createChannel({
    title: "Readable",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const dst = await createChannel({
    title: "Not Alice's",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: src.id,
    text: "bob's",
  });

  // A public channel is readable by all but only its owner and members may add,
  // so the target is what refuses — the source being someone else's is fine.
  const { status } = await denial(await copyBlock(block.id, dst.id, USERS.alice.id));
  expect(status).toBe(403);
});

test("copyBlock 404s on a source in a private channel the caller cannot read", async () => {
  const src = await createChannel({
    title: "Bob's private",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  const dst = await createChannel({
    title: "Alice's",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: src.id,
    text: "secret",
  });

  expect(await denial(await copyBlock(block.id, dst.id, USERS.alice.id))).toEqual({
    status: 404,
    error: "Not found.",
  });
});

test("reorderBlock places a block after its anchor", async () => {
  const ch = await createChannel({
    title: "Ordered",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const mk = (text: string) =>
    uploadTextColumn({ created_by: USERS.alice.id, channel_id: ch.id, text });
  const first = await mk("a");
  const second = await mk("b");
  const third = await mk("c");

  // Newest-first by default, so the channel reads c, b, a.
  const moved = await reorderBlock(third.id, first.id, USERS.alice.id);
  expect(moved).not.toBeInstanceOf(NextResponse);

  const order = (await getChannelColumns(ch.id, { sort: "manual" })).map((c) => c.id);
  expect(order).toEqual([second.id, first.id, third.id]);
});

test("reorderBlock is owner-only, unlike editing a block you added", async () => {
  // Bob's channel is open, so Alice may add to it and edit what she added —
  // but rearranging it moves everyone's blocks, so it follows ownership.
  const ch = await createChannel({
    title: "Bob's open channel",
    access: "open",
    owned_by: USERS.bob.ownerId,
  });
  const bobs = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: ch.id,
    text: "bob's",
  });
  const alices = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "alice's",
  });

  const result = await reorderBlock(alices.id, bobs.id, USERS.alice.id);
  expect(result).toBeInstanceOf(NextResponse);
  expect((result as NextResponse).status).toBe(403);
});

test("reorderBlock 404s on an anchor in another channel", async () => {
  const here = await createChannel({
    title: "Here",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const elsewhere = await createChannel({
    title: "Elsewhere",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: here.id,
    text: "x",
  });
  const foreign = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: elsewhere.id,
    text: "y",
  });

  // A position key only orders a block against its own channel's keys, so an
  // anchor from elsewhere has nothing to be placed relative to.
  const result = await reorderBlock(block.id, foreign.id, USERS.alice.id);
  expect((result as NextResponse).status).toBe(404);
});

// leaveChannel returns null on success and a denial NextResponse otherwise, so
// it needs its own reader — `denial` above is typed for moveBlock's return.
async function leaveDenial(
  result: NextResponse | null,
): Promise<{ status: number; error: string }> {
  expect(result).toBeInstanceOf(NextResponse);
  const res = result as NextResponse;
  const body = (await res.json()) as { error?: string };
  return { status: res.status, error: body.error ?? "" };
}

test("leaveChannel drops the caller's membership", async () => {
  const channel = await createChannel({
    title: "Bob's, with Alice in it",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  await addChannelMemberByHandle(channel.id, USERS.alice.handle);
  expect(await isChannelMember(channel.id, USERS.alice.id)).toBe(true);

  expect(await leaveChannel(channel.id, USERS.alice.id)).toBeNull();
  expect(await isChannelMember(channel.id, USERS.alice.id)).toBe(false);
});

test("leaveChannel refuses the owner, who has no membership to give up", async () => {
  const channel = await createChannel({
    title: "Alice's own",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });

  // Without this guard removeChannelMember deletes nothing and reports success,
  // leaving the owner believing they left a channel they still own.
  const { status, error } = await leaveDenial(await leaveChannel(channel.id, USERS.alice.id));
  expect(status).toBe(409);
  expect(error).toContain("manage this channel");
});

test("leaveChannel refuses someone who was never a member", async () => {
  const channel = await createChannel({
    title: "Bob's, without Alice",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });

  const { status, error } = await leaveDenial(await leaveChannel(channel.id, USERS.alice.id));
  expect(status).toBe(409);
  expect(error).toContain("not a member");
});

test("leaveChannel 404s on a private channel the caller cannot read", async () => {
  const channel = await createChannel({
    title: "Bob's secret",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });

  // A 409 here would confirm the channel exists to someone with no access.
  const { status } = await leaveDenial(await leaveChannel(channel.id, USERS.alice.id));
  expect(status).toBe(404);
});

test("API block payloads carry the markdown source, not the rendered HTML", async () => {
  const ch = await createChannel({ title: "Api", access: "public", owned_by: USERS.alice.ownerId });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "# hi",
  });
  // The write path still renders, because the web client prepends the returned
  // block straight into the grid.
  expect(block.html).toContain("<h1>hi</h1>");

  // The API doesn't: a client that asked for the source gets the source, and
  // the rendered copy would roughly double a text block's payload.
  const single = await attachPreview(block);
  expect(single.text).toBe("# hi");
  expect("html" in single).toBe(false);

  const [listed] = await attachPreviews([block]);
  expect(listed.text).toBe("# hi");
  expect("html" in listed).toBe(false);
});
