import { beforeAll, expect, test } from "bun:test";
import { NextResponse } from "next/server";

import { seed, USERS } from "@/scripts/seed";
import { attachPreview, attachPreviews, moveBlock } from "./api-auth";
import { createMedia, putBlob } from "./blob";
import { createChannel } from "./channel";
import { Column, getChannelColumns, uploadTextColumn, uploadURLColumn } from "./column";
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
  const src = await createChannel({ title: "From", access: "public", owner_id: USERS.alice.id });
  const dst = await createChannel({ title: "To", access: "private", owner_id: USERS.alice.id });

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
  const ch = await createChannel({ title: "Stay", access: "public", owner_id: USERS.alice.id });
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
  const src = await createChannel({ title: "Bob's", access: "public", owner_id: USERS.bob.id });
  const dst = await createChannel({ title: "Alice's", access: "public", owner_id: USERS.alice.id });
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
  const src = await createChannel({ title: "Mine", access: "public", owner_id: USERS.alice.id });
  const dst = await createChannel({ title: "Theirs", access: "public", owner_id: USERS.bob.id });
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
  const src = await createChannel({ title: "Src", access: "public", owner_id: USERS.alice.id });
  const dst = await createChannel({ title: "Hidden", access: "private", owner_id: USERS.bob.id });
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
  const src = await createChannel({ title: "Src", access: "public", owner_id: USERS.alice.id });
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

test("API block payloads carry the markdown source, not the rendered HTML", async () => {
  const ch = await createChannel({ title: "Api", access: "public", owner_id: USERS.alice.id });
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
