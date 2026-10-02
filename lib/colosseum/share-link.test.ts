import { beforeAll, expect, test } from "bun:test";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { column, shareLink } from "@/lib/db/schema";
import { seed, USERS } from "@/scripts/seed";
import { setUserBanned } from "./admin";
import { createShareLinkFor, listShareLinksFor, revokeShareLinkFor } from "./api-auth";
import { createChannel } from "./channel";
import { moveColumn, uploadTextColumn } from "./column";
import { buildChannelExport } from "./export";
import {
  DEFAULT_SHARE_EXPIRY_DAYS,
  createShareLink,
  hashShareToken,
  listShareLinks,
  parseShareExpiryDays,
  resolveShareToken,
  revokeShareLink,
  shareColumn,
  shareCoversBlock,
  shareCoversChannel,
  shareCoversMedia,
  shareExpiry,
  shareMediaUrl,
  stripShareToken,
} from "./share-link";

beforeAll(async () => {
  await seed();
});

async function privateChannel(title = "Private shelf") {
  return createChannel({ title, access: "private", owned_by: USERS.alice.ownerId });
}

async function textBlock(channelId: number, text = "hello") {
  return uploadTextColumn({ created_by: USERS.alice.id, channel_id: channelId, text });
}

// An image block pointing at a media id, without storing real bytes: the share
// check only reads the column's `image` field.
async function imageBlock(channelId: number, mediaId: string) {
  const [row] = await db
    .insert(column)
    .values({
      type: "image",
      channel_id: channelId,
      created_by: USERS.alice.id,
      image: `/api/media/${mediaId}`,
    })
    .returning({ id: column.id });
  return row.id;
}

test("a link stores only the hash of its token, and the token resolves", async () => {
  const ch = await privateChannel();
  const { link, token } = await createShareLink({
    channelId: ch.id,
    expiresAt: shareExpiry(30),
    createdBy: USERS.alice.id,
  });
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const [row] = await db.select().from(shareLink).where(eq(shareLink.id, link.id));
  expect(row.token_hash).toBe(hashShareToken(token));
  expect(Object.values(row)).not.toContain(token);

  const share = await resolveShareToken(token);
  expect(share?.channel.id).toBe(ch.id);
  expect(share?.block).toBeNull();
});

test("unknown, malformed, revoked and expired tokens resolve to nothing", async () => {
  const ch = await privateChannel();
  expect(await resolveShareToken("not-a-token")).toBeNull();
  expect(await resolveShareToken("a".repeat(43))).toBeNull();

  const revoked = await createShareLink({ channelId: ch.id, expiresAt: null, createdBy: null });
  expect(await revokeShareLink(revoked.link.id, ch.id)).toBe(true);
  expect(await resolveShareToken(revoked.token)).toBeNull();
  // Already revoked: nothing left to revoke.
  expect(await revokeShareLink(revoked.link.id, ch.id)).toBe(false);

  const expired = await createShareLink({
    channelId: ch.id,
    expiresAt: new Date(Date.now() - 1000),
    createdBy: null,
  });
  expect(await resolveShareToken(expired.token)).toBeNull();

  const never = await createShareLink({ channelId: ch.id, expiresAt: null, createdBy: null });
  expect((await resolveShareToken(never.token))?.link.expires_at).toBeNull();
});

test("revoking needs the link's own channel", async () => {
  const ch = await privateChannel();
  const other = await privateChannel("Elsewhere");
  const { link, token } = await createShareLink({
    channelId: ch.id,
    expiresAt: null,
    createdBy: null,
  });
  expect(await revokeShareLink(link.id, other.id)).toBe(false);
  expect(await resolveShareToken(token)).not.toBeNull();
});

test("a channel link covers every block in its channel and nothing outside it", async () => {
  const ch = await privateChannel();
  const other = await privateChannel("Elsewhere");
  const a = await textBlock(ch.id, "a");
  const b = await textBlock(ch.id, "b");
  const outside = await textBlock(other.id, "outside");
  const { token } = await createShareLink({ channelId: ch.id, expiresAt: null, createdBy: null });
  const share = (await resolveShareToken(token))!;

  expect(shareCoversChannel(share, ch.id)).toBe(true);
  expect(shareCoversChannel(share, other.id)).toBe(false);
  expect(shareCoversBlock(share, a)).toBe(true);
  expect(shareCoversBlock(share, b)).toBe(true);
  expect(shareCoversBlock(share, outside)).toBe(false);
});

test("a block link covers its block only, and dies when the block leaves the channel", async () => {
  const ch = await privateChannel();
  const other = await privateChannel("Elsewhere");
  const shared = await textBlock(ch.id, "shared");
  const sibling = await textBlock(ch.id, "sibling");
  const { token } = await createShareLink({
    channelId: ch.id,
    blockId: shared.id,
    expiresAt: null,
    createdBy: null,
  });
  const share = (await resolveShareToken(token))!;

  expect(share.block?.id).toBe(shared.id);
  expect(shareCoversChannel(share, ch.id)).toBe(false);
  expect(shareCoversBlock(share, shared)).toBe(true);
  expect(shareCoversBlock(share, sibling)).toBe(false);

  await moveColumn(shared.id, other.id);
  expect(await resolveShareToken(token)).toBeNull();
});

test("a share opens the media of blocks it covers and no other", async () => {
  const ch = await privateChannel();
  const other = await privateChannel("Elsewhere");
  const mine = crypto.randomUUID();
  const theirs = crypto.randomUUID();
  const sibling = crypto.randomUUID();
  const mineId = await imageBlock(ch.id, mine);
  await imageBlock(ch.id, sibling);
  await imageBlock(other.id, theirs);

  const channelLink = await createShareLink({ channelId: ch.id, expiresAt: null, createdBy: null });
  const channelShare = (await resolveShareToken(channelLink.token))!;
  expect(await shareCoversMedia(channelShare, mine)).toBe(true);
  expect(await shareCoversMedia(channelShare, sibling)).toBe(true);
  expect(await shareCoversMedia(channelShare, theirs)).toBe(false);

  const blockLink = await createShareLink({
    channelId: ch.id,
    blockId: mineId,
    expiresAt: null,
    createdBy: null,
  });
  const blockShare = (await resolveShareToken(blockLink.token))!;
  expect(await shareCoversMedia(blockShare, mine)).toBe(true);
  expect(await shareCoversMedia(blockShare, sibling)).toBe(false);
});

test("listing keeps block links and expired ones, and drops revoked ones", async () => {
  const ch = await privateChannel();
  const block = await textBlock(ch.id);
  const whole = await createShareLink({
    channelId: ch.id,
    label: "whole",
    expiresAt: null,
    createdBy: null,
  });
  const one = await createShareLink({
    channelId: ch.id,
    blockId: block.id,
    expiresAt: null,
    createdBy: null,
  });
  const old = await createShareLink({
    channelId: ch.id,
    expiresAt: new Date(Date.now() - 1000),
    createdBy: null,
  });
  const gone = await createShareLink({ channelId: ch.id, expiresAt: null, createdBy: null });
  await revokeShareLink(gone.link.id, ch.id);

  const ids = (await listShareLinks(ch.id)).map((l) => l.id);
  expect(ids).toContain(whole.link.id);
  expect(ids).toContain(one.link.id);
  expect(ids).toContain(old.link.id);
  expect(ids).not.toContain(gone.link.id);
});

test("media URLs move under the share route, keep their query, and pass others through", () => {
  const id = "0b8f8c1e-3a7d-4c39-9a51-0d6c2a1e4f10";
  expect(shareMediaUrl(`/api/media/${id}`, "tok")).toBe(`/api/media/${id}/s/tok`);
  expect(shareMediaUrl(`/api/media/${id}?v=2`, "tok")).toBe(`/api/media/${id}/s/tok?v=2`);
  // Rewriting twice is harmless: the second pass sees a share URL and leaves it.
  expect(shareMediaUrl(shareMediaUrl(`/api/media/${id}`, "tok"), "tok")).toBe(
    `/api/media/${id}/s/tok`,
  );
  expect(shareMediaUrl("https://example.com/a.png", "tok")).toBe("https://example.com/a.png");
});

test("shareColumn rewrites only the media field", async () => {
  const ch = await privateChannel();
  const block = await textBlock(ch.id);
  expect(shareColumn(block, "tok")).toEqual(block);
  const withImage = { ...block, image: "/api/media/0b8f8c1e-3a7d-4c39-9a51-0d6c2a1e4f10" };
  expect(shareColumn(withImage, "tok").image).toBe(
    "/api/media/0b8f8c1e-3a7d-4c39-9a51-0d6c2a1e4f10/s/tok",
  );
});

test("expiry input: omitted is the default, null is never, out of range is invalid", () => {
  expect(parseShareExpiryDays(undefined)).toBe(DEFAULT_SHARE_EXPIRY_DAYS);
  expect(parseShareExpiryDays(null)).toBeNull();
  expect(parseShareExpiryDays(7)).toBe(7);
  expect(parseShareExpiryDays(0)).toBe("invalid");
  expect(parseShareExpiryDays(1.5)).toBe("invalid");
  expect(parseShareExpiryDays(99999)).toBe("invalid");
  expect(parseShareExpiryDays("30")).toBe("invalid");
});

test("the API makes links only for a manager of a private channel", async () => {
  const ch = await privateChannel();
  const publicCh = await createChannel({
    title: "Out in the open",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });

  const made = await createShareLinkFor(ch.id, { label: "for Sam" }, USERS.alice.id);
  expect(made).not.toBeInstanceOf(NextResponse);
  const { share_link, url } = made as Exclude<typeof made, NextResponse>;
  expect(share_link.label).toBe("for Sam");
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
  const days = (new Date(share_link.expires_at!).getTime() - Date.now()) / 86_400_000;
  expect(Math.round(days)).toBe(DEFAULT_SHARE_EXPIRY_DAYS);

  // Someone who can't see the channel gets the same 404 the channel would give.
  const outsider = await createShareLinkFor(ch.id, {}, USERS.bob.id);
  expect((outsider as NextResponse).status).toBe(404);
  // A public channel needs no link.
  const open = await createShareLinkFor(publicCh.id, {}, USERS.alice.id);
  expect((open as NextResponse).status).toBe(400);
  // A block from another channel isn't this channel's to share.
  const elsewhere = await privateChannel("Elsewhere");
  const foreign = await textBlock(elsewhere.id);
  const wrongBlock = await createShareLinkFor(ch.id, { blockId: foreign.id }, USERS.alice.id);
  expect((wrongBlock as NextResponse).status).toBe(404);
  const badExpiry = await createShareLinkFor(ch.id, { expiresInDays: 0 }, USERS.alice.id);
  expect((badExpiry as NextResponse).status).toBe(400);
});

test("the API lists and revokes for the manager only", async () => {
  const ch = await privateChannel();
  const made = (await createShareLinkFor(ch.id, { expiresInDays: null }, USERS.alice.id)) as {
    share_link: { id: string; expires_at: string | null };
    url: string;
  };
  expect(made.share_link.expires_at).toBeNull();

  expect(((await listShareLinksFor(ch.id, USERS.bob.id)) as NextResponse).status).toBe(404);
  const listed = await listShareLinksFor(ch.id, USERS.alice.id);
  expect((listed as { id: string }[]).map((l) => l.id)).toContain(made.share_link.id);

  expect((await revokeShareLinkFor(made.share_link.id, USERS.bob.id))?.status).toBe(404);
  expect(await revokeShareLinkFor(made.share_link.id, USERS.alice.id)).toBeNull();
  const token = made.url.split("/s/")[1];
  expect(await resolveShareToken(token)).toBeNull();
});

test("a ban on the link's creator or on the channel's owner takes the link down, and an unban restores it", async () => {
  const bobs = await createChannel({
    title: "Bob's private",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  const ownedByBob = await createShareLink({
    channelId: bobs.id,
    expiresAt: null,
    createdBy: USERS.bob.id,
  });
  // On alice's channel, but made by bob (an admin of a group channel, say).
  const alices = await privateChannel();
  const madeByBob = await createShareLink({
    channelId: alices.id,
    expiresAt: null,
    createdBy: USERS.bob.id,
  });
  const madeByAlice = await createShareLink({
    channelId: alices.id,
    expiresAt: null,
    createdBy: USERS.alice.id,
  });

  await setUserBanned(USERS.bob.id, true);
  try {
    expect(await resolveShareToken(ownedByBob.token)).toBeNull();
    expect(await resolveShareToken(madeByBob.token)).toBeNull();
    expect(await resolveShareToken(madeByAlice.token)).not.toBeNull();
  } finally {
    await setUserBanned(USERS.bob.id, false);
  }
  expect(await resolveShareToken(ownedByBob.token)).not.toBeNull();
  expect(await resolveShareToken(madeByBob.token)).not.toBeNull();
});

test("a listed link says whether it still opens anything, and names its block", async () => {
  const ch = await privateChannel();
  const other = await privateChannel("Elsewhere");
  const block = await textBlock(ch.id);
  await db.update(column).set({ title: "Field notes" }).where(eq(column.id, block.id));
  const live = await createShareLink({
    channelId: ch.id,
    blockId: block.id,
    expiresAt: null,
    createdBy: null,
  });
  const old = await createShareLink({
    channelId: ch.id,
    expiresAt: new Date(Date.now() - 1000),
    createdBy: null,
  });
  expect(live.link.status).toBe("active");
  expect(live.link.block_label).toBe("Field notes");

  await moveColumn(block.id, other.id);
  const byId = new Map((await listShareLinks(ch.id)).map((l) => [l.id, l]));
  expect(byId.get(live.link.id)?.status).toBe("block_moved");
  expect(byId.get(live.link.id)?.block_label).toBe("Field notes");
  expect(byId.get(old.link.id)?.status).toBe("expired");
  expect(byId.get(old.link.id)?.block_label).toBeNull();
});

test("a malformed link id is a 404, not a database error", async () => {
  expect((await revokeShareLinkFor("-".repeat(36), USERS.alice.id))?.status).toBe(404);
  expect((await revokeShareLinkFor("not-an-id", USERS.alice.id))?.status).toBe(404);
});

test("an export doesn't carry a share link's token", () => {
  const id = "0b8f8c1e-3a7d-4c39-9a51-0d6c2a1e4f10";
  expect(stripShareToken(`/api/media/${id}/s/abc_DEF-123`)).toBe(`/api/media/${id}`);
  expect(stripShareToken(`/api/media/${id}/s/abc?thumb`)).toBe(`/api/media/${id}?thumb`);
  expect(stripShareToken(`/api/media/${id}`)).toBe(`/api/media/${id}`);
  expect(stripShareToken("https://example.com/s/abc")).toBe("https://example.com/s/abc");

  const data = buildChannelExport(
    { title: "Shared" },
    [
      {
        id: 1,
        created_at: "2026-01-01T00:00:00Z",
        type: "image",
        created_by: "u1",
        channel_id: 1,
        tags: [],
        image: shareMediaUrl(`/api/media/${id}`, "secret-token"),
      },
    ],
    new Map(),
  );
  expect(data.blocks[0].image).toBe(`/api/media/${id}`);
  expect(JSON.stringify(data)).not.toContain("secret-token");
});
