import { beforeAll, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import sharp from "sharp";

import { GET as shareMediaGET } from "@/app/api/media/[id]/s/[token]/route";
import { seed, USERS } from "@/scripts/seed";
import {
  getChannelColumnCountAction,
  getChannelColumnsAction,
  getColumnCommentsAction,
  getColumnNeighboursAction,
} from "./actions";
import { mediaIdFromUrl, putImageBlob } from "./blob";
import { getCanvasBlocksAction, getUnplacedBlocksAction } from "./canvas-actions";
import { startCanvasThread } from "./canvas-thread";
import { getCanvasThreadAction, listCanvasThreadsAction } from "./canvas-thread-actions";
import { createChannel } from "./channel";
import { addChannelColumn, uploadImageColumn, uploadTextColumn } from "./column";
import { createComment } from "./comment";
import { createShareLink, revokeShareLink } from "./share-link";

// The reads a link holder's page makes. None of these calls has a session, so
// the token is the only thing that can let them through.

beforeAll(async () => {
  await seed();
});

async function privateChannel(title = "Private shelf") {
  return createChannel({ title, access: "private", owned_by: USERS.alice.ownerId });
}

async function textBlock(channelId: number, text = "hello") {
  return uploadTextColumn({ created_by: USERS.alice.id, channel_id: channelId, text });
}

async function link(channelId: number, blockId?: number) {
  return (await createShareLink({ channelId, blockId, expiresAt: null, createdBy: USERS.alice.id }))
    .token;
}

test("a channel link reads its own channel's blocks, count and neighbours, and no other", async () => {
  const ch = await privateChannel();
  const other = await privateChannel("Elsewhere");
  const a = await textBlock(ch.id, "a");
  await textBlock(ch.id, "b");
  await textBlock(other.id, "outside");
  const token = await link(ch.id);

  const blocks = await getChannelColumnsAction(ch.id, {}, token);
  expect(blocks.map((b) => b.channel_id)).toEqual([ch.id, ch.id]);
  expect(await getChannelColumnCountAction(ch.id, {}, token)).toBe(2);
  const { prev, next } = await getColumnNeighboursAction(ch.id, a.id, {}, token);
  expect([prev?.channel_id, next?.channel_id].filter(Boolean)).toEqual([ch.id]);

  await expect(getChannelColumnsAction(other.id, {}, token)).rejects.toThrow("Not found.");
  await expect(getChannelColumnCountAction(other.id, {}, token)).rejects.toThrow("Not found.");
  await expect(getColumnNeighboursAction(other.id, a.id, {}, token)).rejects.toThrow("Not found.");
});

test("a made-up or revoked token keeps a private channel shut", async () => {
  const ch = await privateChannel();
  await textBlock(ch.id);
  const { link: row, token } = await createShareLink({
    channelId: ch.id,
    expiresAt: null,
    createdBy: USERS.alice.id,
  });

  // The token-less path reads the session, which needs a request; a made-up
  // token never gets that far.
  await expect(getChannelColumnsAction(ch.id, {}, "x".repeat(43))).rejects.toThrow("Not found.");

  expect((await getChannelColumnsAction(ch.id, {}, token)).length).toBe(1);
  await revokeShareLink(row.id, ch.id);
  await expect(getChannelColumnsAction(ch.id, {}, token)).rejects.toThrow("Not found.");
});

test("a block link can't page through its channel", async () => {
  const ch = await privateChannel();
  const shared = await textBlock(ch.id, "shared");
  await textBlock(ch.id, "sibling");
  const token = await link(ch.id, shared.id);

  await expect(getChannelColumnsAction(ch.id, {}, token)).rejects.toThrow("Not found.");
  await expect(getChannelColumnCountAction(ch.id, {}, token)).rejects.toThrow("Not found.");
  await expect(getColumnNeighboursAction(ch.id, shared.id, {}, token)).rejects.toThrow(
    "Not found.",
  );
});

test("comments open for the blocks a link covers and no others", async () => {
  const ch = await privateChannel();
  const other = await privateChannel("Elsewhere");
  const shared = await textBlock(ch.id, "shared");
  const sibling = await textBlock(ch.id, "sibling");
  const outside = await textBlock(other.id, "outside");
  await createComment({ column_id: shared.id, author_id: USERS.alice.id, body: "on shared" });

  const channelToken = await link(ch.id);
  expect((await getColumnCommentsAction(shared.id, channelToken)).map((c) => c.body)).toEqual([
    "on shared",
  ]);
  expect(await getColumnCommentsAction(sibling.id, channelToken)).toEqual([]);
  await expect(getColumnCommentsAction(outside.id, channelToken)).rejects.toThrow("Not found.");

  const blockToken = await link(ch.id, shared.id);
  expect((await getColumnCommentsAction(shared.id, blockToken)).length).toBe(1);
  await expect(getColumnCommentsAction(sibling.id, blockToken)).rejects.toThrow("Not found.");
});

test("a nested private channel stays a stub to a link holder", async () => {
  const ch = await privateChannel();
  const hidden = await privateChannel("Hidden");
  await addChannelColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    linked_channel_id: hidden.id,
  });
  const token = await link(ch.id);

  const [nested] = await getChannelColumnsAction(ch.id, {}, token);
  expect(nested.type).toBe("channel");
  expect(nested.linked_channel?.title).not.toBe("Hidden");
});

test("the share media route serves covered media, and 404s everything else", async () => {
  const ch = await privateChannel();
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
  const url = await putImageBlob(
    new File([new Uint8Array(png)], "dot.png", { type: "image/png" }),
    USERS.alice.id,
    "private",
  );
  const image = await uploadImageColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    image: url,
  });
  const sibling = await textBlock(ch.id);
  const id = mediaIdFromUrl(url)!;

  const get = (token: string) =>
    shareMediaGET(new NextRequest(`http://localhost/api/media/${id}/s/${token}`), {
      params: Promise.resolve({ id, token }),
    });

  const channelToken = await link(ch.id);
  const ok = await get(channelToken);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("Content-Type")).toBe("image/png");

  expect((await get(await link(ch.id, image.id))).status).toBe(200);
  expect((await get(await link(ch.id, sibling.id))).status).toBe(404);
  expect((await get("y".repeat(43))).status).toBe(404);

  const other = await privateChannel("Elsewhere");
  expect((await get(await link(other.id))).status).toBe(404);
});

test("a channel link reads the canvas's blocks and threads, and no other channel's", async () => {
  const ch = await privateChannel("Canvas shelf");
  const other = await privateChannel("Canvas elsewhere");
  const mine = await textBlock(ch.id, "mine");
  const theirs = await textBlock(other.id, "theirs");
  const thread = await startCanvasThread({
    channelId: ch.id,
    userId: USERS.alice.id,
    anchor: { x: 1, y: 2 },
    body: "look here",
  });
  const elsewhere = await startCanvasThread({
    channelId: other.id,
    userId: USERS.alice.id,
    anchor: { x: 1, y: 2 },
    body: "private",
  });
  const token = await link(ch.id);

  const blocks = await getCanvasBlocksAction(ch.id, [mine.id, theirs.id], token);
  expect(blocks.map((b) => b.id)).toEqual([mine.id]);
  const { columns, count } = await getUnplacedBlocksAction(ch.id, { placed: [] }, token);
  expect(columns.map((b) => b.id)).toEqual([mine.id]);
  expect(count).toBe(1);

  expect((await listCanvasThreadsAction(ch.id, undefined, token)).map((t) => t.id)).toEqual([
    thread.id,
  ]);
  const read = await getCanvasThreadAction(thread.id, { token, channelId: ch.id });
  expect(read.comments.map((c) => c.body)).toEqual(["look here"]);

  await expect(getCanvasBlocksAction(other.id, [theirs.id], token)).rejects.toThrow("Not found.");
  await expect(getUnplacedBlocksAction(other.id, { placed: [] }, token)).rejects.toThrow(
    "Not found.",
  );
  await expect(listCanvasThreadsAction(other.id, undefined, token)).rejects.toThrow("Not found.");
  await expect(getCanvasThreadAction(elsewhere.id, { token, channelId: ch.id })).rejects.toThrow(
    "Not found.",
  );
  await expect(getCanvasThreadAction(elsewhere.id, { token, channelId: other.id })).rejects.toThrow(
    "Not found.",
  );
});

test("a block link, a made-up token and a revoked link read nothing off the canvas", async () => {
  const ch = await privateChannel("Canvas shut");
  const shared = await textBlock(ch.id, "shared");
  const blockToken = await link(ch.id, shared.id);
  await expect(getCanvasBlocksAction(ch.id, [shared.id], blockToken)).rejects.toThrow("Not found.");
  await expect(listCanvasThreadsAction(ch.id, undefined, blockToken)).rejects.toThrow("Not found.");
  await expect(getCanvasBlocksAction(ch.id, [shared.id], "x".repeat(43))).rejects.toThrow(
    "Not found.",
  );

  const { link: row, token } = await createShareLink({
    channelId: ch.id,
    expiresAt: null,
    createdBy: USERS.alice.id,
  });
  expect((await getCanvasBlocksAction(ch.id, [shared.id], token)).length).toBe(1);
  await revokeShareLink(row.id, ch.id);
  await expect(getCanvasBlocksAction(ch.id, [shared.id], token)).rejects.toThrow("Not found.");
});
