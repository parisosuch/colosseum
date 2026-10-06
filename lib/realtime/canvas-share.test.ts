import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";

import * as Y from "yjs";

import { setUserBanned } from "@/lib/colosseum/admin";
import { createChannel, deleteChannel } from "@/lib/colosseum/channel";
import { uploadTextColumn } from "@/lib/colosseum/column";
import { createShareLink, revokeShareLink } from "@/lib/colosseum/share-link";
import { db } from "@/lib/db";
import { channelCanvas } from "@/lib/db/schema";
import { seed, USERS } from "@/scripts/seed";
import { elementsOf } from "./canvas-doc";
import { affects } from "./canvas-permissions";
import {
  connectAs,
  connectWithShare,
  destroyClients,
  lastSession,
  sleep,
  startHarness,
  synced,
  waitFor,
  type Harness,
} from "./canvas-test-harness";
import { CLOSE_ACCESS_REVOKED } from "./protocol";

// A channel share link opens the channel's canvas, read-only, and its sockets
// die with the link.

const alice = USERS.alice;
const bob = USERS.bob;

let harness: Harness;
const channels: number[] = [];

async function privateChannel(): Promise<number> {
  const ch = await createChannel({
    title: `Share canvas ${channels.length}`,
    access: "private",
    owned_by: alice.ownerId,
  });
  channels.push(ch.id);
  return ch.id;
}

async function channelLink(
  channelId: number,
  opts: { createdBy?: string; expiresAt?: Date | null; blockId?: number } = {},
) {
  return createShareLink({
    channelId,
    blockId: opts.blockId,
    expiresAt: opts.expiresAt ?? null,
    createdBy: opts.createdBy ?? alice.id,
  });
}

function addShape(doc: Y.Doc, key: string) {
  const el = new Y.Map<unknown>();
  el.set("type", "rect");
  el.set("x", 0);
  el.set("y", 0);
  elementsOf(doc).set(key, el);
}

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  for (const id of channels) await deleteChannel(id).catch(() => {});
  await setUserBanned(bob.id, false);
});

beforeEach(async () => {
  await db.delete(channelCanvas);
  harness = await startHarness({ pingIntervalMs: 50 });
});

afterEach(async () => {
  destroyClients();
  await harness.close();
});

test("a share socket sees the canvas live and can't change it", async () => {
  const id = await privateChannel();
  const { token } = await channelLink(id);
  const owner = connectAs(harness, id, alice.id);
  await synced(owner.provider);
  addShape(owner.doc, "from-alice");

  const holder = connectWithShare(harness, id, token);
  await synced(holder.provider);
  await waitFor(() => elementsOf(holder.doc).has("from-alice"), "the existing shape");
  expect(lastSession(holder)?.access).toBe("read");

  addShape(owner.doc, "live");
  await waitFor(() => elementsOf(holder.doc).has("live"), "a live edit");

  addShape(holder.doc, "from-holder");
  await sleep(150);
  expect(elementsOf(owner.doc).has("from-holder")).toBe(false);
});

test("a signed-out socket without a link is refused on a private channel", async () => {
  const id = await privateChannel();
  const out = connectAs(harness, id, null);
  await waitFor(() => out.closes.includes(CLOSE_ACCESS_REVOKED), "the refusal");
});

test("a made-up token and a link to another channel are refused", async () => {
  const id = await privateChannel();
  const other = await privateChannel();
  const elsewhere = await channelLink(other);

  const fake = connectWithShare(harness, id, "x".repeat(43));
  const wrongChannel = connectWithShare(harness, id, elsewhere.token);
  await waitFor(() => fake.closes.includes(CLOSE_ACCESS_REVOKED), "the made-up token refused");
  await waitFor(() => wrongChannel.closes.includes(CLOSE_ACCESS_REVOKED), "the wrong channel");
});

test("a block link doesn't open the canvas", async () => {
  const id = await privateChannel();
  const block = await uploadTextColumn({ created_by: alice.id, channel_id: id, text: "one" });
  const { token } = await channelLink(id, { blockId: block.id });

  const holder = connectWithShare(harness, id, token);
  await waitFor(() => holder.closes.includes(CLOSE_ACCESS_REVOKED), "the block link refused");
});

test("revoking the link closes its open sockets, and leaves other links alone", async () => {
  const id = await privateChannel();
  const first = await channelLink(id);
  const second = await channelLink(id);
  const a = connectWithShare(harness, id, first.token);
  const b = connectWithShare(harness, id, second.token);
  await Promise.all([synced(a.provider), synced(b.provider)]);

  await revokeShareLink(first.link.id, id);

  await waitFor(() => a.closes.includes(CLOSE_ACCESS_REVOKED), "the revoked link's socket");
  await sleep(150);
  expect(b.closes).toEqual([]);
  expect(b.provider.wsconnected).toBe(true);
});

test("banning a link's creator closes its sockets and no one else's", async () => {
  const id = await privateChannel();
  const bobs = await channelLink(id, { createdBy: bob.id });
  const alices = await channelLink(id, { createdBy: alice.id });
  const a = connectWithShare(harness, id, alices.token);
  const b = connectWithShare(harness, id, bobs.token);
  await Promise.all([synced(a.provider), synced(b.provider)]);

  await setUserBanned(bob.id, true);

  await waitFor(() => b.closes.includes(CLOSE_ACCESS_REVOKED), "the ban to close bob's link");
  await sleep(150);
  expect(a.closes).toEqual([]);
  expect(a.provider.wsconnected).toBe(true);
});

test("a link that expires closes its open socket", async () => {
  const id = await privateChannel();
  const { token } = await channelLink(id, { expiresAt: new Date(Date.now() + 700) });
  const holder = connectWithShare(harness, id, token);
  await synced(holder.provider);
  expect(holder.closes).toEqual([]);

  await waitFor(() => holder.closes.includes(CLOSE_ACCESS_REVOKED), "the expiry to close it", 3000);
});

test("a user event for no channel reaches share sockets, one for a channel doesn't", () => {
  const ban = { type: "user.access-changed", userId: bob.id } as const;
  expect(affects(ban, 3, null, true)).toBe(true);
  expect(affects(ban, 3, null, false)).toBe(false);
  const removed = { type: "user.access-changed", userId: bob.id, channelId: 3 } as const;
  expect(affects(removed, 3, null, true)).toBe(false);
});
