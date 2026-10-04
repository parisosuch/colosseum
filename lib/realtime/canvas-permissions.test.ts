import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { setUserBanned } from "@/lib/colosseum/admin";
import {
  createChannel,
  deleteChannel,
  transferChannel,
  updateChannel,
  type ChannelAccess,
} from "@/lib/colosseum/channel";
import {
  addGroupMemberByHandle,
  createGroup,
  deleteGroup,
  removeGroupMember,
  setGroupRole,
} from "@/lib/colosseum/group";
import { addChannelMemberByHandle, removeChannelMember } from "@/lib/colosseum/member";
import { db } from "@/lib/db";
import { channelCanvas } from "@/lib/db/schema";
import { seed, USERS } from "@/scripts/seed";
import { elementsOf } from "./canvas-doc";
import { affects } from "./canvas-permissions";
import {
  connectAs,
  destroyClients,
  lastSession,
  sleep,
  startHarness,
  synced,
  waitFor,
  type Client,
  type Harness,
} from "./canvas-test-harness";
import { CLOSE_ACCESS_REVOKED, CLOSE_CHANNEL_GONE } from "./protocol";

const alice = USERS.alice;
const bob = USERS.bob;

let harness: Harness;
const channels: number[] = [];

async function channelOf(access: ChannelAccess, ownedBy = alice.ownerId): Promise<number> {
  const ch = await createChannel({
    title: `Permissions ${access} ${channels.length}`,
    access,
    owned_by: ownedBy,
  });
  channels.push(ch.id);
  return ch.id;
}

async function setAccess(id: number, access: ChannelAccess) {
  await updateChannel(id, { title: `Permissions ${access} ${id}`, access });
}

function addShape(doc: Y.Doc, key: string) {
  const el = new Y.Map<unknown>();
  el.set("type", "rect");
  el.set("x", 0);
  el.set("y", 0);
  elementsOf(doc).set(key, el);
}

async function storedHas(id: number, key: string): Promise<boolean> {
  const [row] = await db.select().from(channelCanvas).where(eq(channelCanvas.channel_id, id));
  if (!row) return false;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.doc);
  return elementsOf(doc).has(key);
}

const closedWith = (c: Client, code: number) => () => c.closes.includes(code);
const accessOf = (c: Client) => lastSession(c)?.access;

// Bob's edit never reaches alice or storage. A marker alice adds afterwards
// proves the server was still relaying to bob's socket.
async function expectEditDropped(id: number, from: Client, to: Client, key: string) {
  addShape(from.doc, key);
  await sleep(100);
  addShape(to.doc, `${key}-marker`);
  await waitFor(() => elementsOf(from.doc).has(`${key}-marker`), "the marker on the sender");
  await sleep(150);
  expect(elementsOf(to.doc).has(key)).toBe(false);
  expect(await storedHas(id, key)).toBe(false);
}

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  for (const id of channels) await deleteChannel(id).catch(() => {});
});

beforeEach(async () => {
  await db.delete(channelCanvas);
  harness = await startHarness();
});

afterEach(async () => {
  destroyClients();
  await harness.close();
});

test("events pick out the sockets they can affect", () => {
  const channelWide = { type: "channel.access-changed", channelId: 1 } as const;
  expect(affects(channelWide, 1, null)).toBe(true);
  expect(affects(channelWide, 2, alice.id)).toBe(false);
  const oneChannel = { type: "user.access-changed", userId: bob.id, channelId: 1 } as const;
  expect(affects(oneChannel, 1, bob.id)).toBe(true);
  expect(affects(oneChannel, 1, alice.id)).toBe(false);
  expect(affects(oneChannel, 2, bob.id)).toBe(false);
  const everywhere = { type: "user.access-changed", userId: bob.id } as const;
  expect(affects(everywhere, 7, bob.id)).toBe(true);
  expect(affects(everywhere, 7, null)).toBe(false);
});

test("removing a member from a private channel closes their canvas with 4403", async () => {
  const id = await channelOf("private");
  await addChannelMemberByHandle(id, bob.handle);
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  await Promise.all([synced(a.provider), synced(b.provider)]);
  b.provider.awareness.setLocalStateField("cursor", { x: 1, y: 1 });
  await waitFor(() => a.provider.awareness.getStates().has(b.doc.clientID), "bob in presence");

  await removeChannelMember(id, bob.id);

  await waitFor(closedWith(b, CLOSE_ACCESS_REVOKED), "bob's socket to close");
  await waitFor(() => !a.provider.awareness.getStates().has(b.doc.clientID), "bob to leave");
  // 4403 is final: the provider gives up rather than reconnecting.
  await sleep(150);
  expect(b.provider.wsconnected).toBe(false);
  expect(b.provider.shouldConnect).toBe(false);
  expect(a.provider.wsconnected).toBe(true);
});

test("removing a member from a public channel drops them to read-only", async () => {
  const id = await channelOf("public");
  await addChannelMemberByHandle(id, bob.handle);
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  await Promise.all([synced(a.provider), synced(b.provider)]);
  await waitFor(() => accessOf(b) === "write", "bob to start as an editor");
  b.provider.awareness.setLocalStateField("cursor", { x: 1, y: 1 });
  await waitFor(() => a.provider.awareness.getStates().has(b.doc.clientID), "bob in presence");

  await removeChannelMember(id, bob.id);

  await waitFor(() => accessOf(b) === "read", "bob's session to say read");
  expect(lastSession(b)?.user).toBeNull();
  await waitFor(() => !a.provider.awareness.getStates().has(b.doc.clientID), "bob to leave");
  // His cursor moving again doesn't bring him back.
  b.provider.awareness.setLocalStateField("cursor", { x: 2, y: 2 });
  await expectEditDropped(id, b, a, "after-removal");
  expect(a.provider.awareness.getStates().has(b.doc.clientID)).toBe(false);
  expect(b.provider.wsconnected).toBe(true);
});

test("making a channel private closes signed-out readers and keeps the owner", async () => {
  const id = await channelOf("public");
  const a = connectAs(harness, id, alice.id);
  const anon = connectAs(harness, id, null);
  await Promise.all([synced(a.provider), synced(anon.provider)]);

  await setAccess(id, "private");

  await waitFor(closedWith(anon, CLOSE_ACCESS_REVOKED), "the signed-out socket to close");
  await sleep(100);
  expect(a.closes).toEqual([]);
  expect(accessOf(a)).toBe("write");
});

test("closing an open channel to public drops non-members to read-only", async () => {
  const id = await channelOf("open");
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  await Promise.all([synced(a.provider), synced(b.provider)]);
  await waitFor(() => accessOf(b) === "write", "bob to start as an editor");

  await setAccess(id, "public");

  await waitFor(() => accessOf(b) === "read", "bob's session to say read");
  await expectEditDropped(id, b, a, "after-close");
});

test("opening a public channel lets signed-in readers write without reconnecting", async () => {
  const id = await channelOf("public");
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  await Promise.all([synced(a.provider), synced(b.provider)]);
  await waitFor(() => accessOf(b) === "read", "bob to start read-only");

  await setAccess(id, "open");

  await waitFor(() => accessOf(b) === "write", "bob's session to say write");
  expect(lastSession(b)?.user?.id).toBe(bob.id);
  addShape(b.doc, "after-open");
  await waitFor(() => elementsOf(a.doc).has("after-open"), "bob's edit on alice");
});

test("a rename that leaves the access mode alone re-checks nobody", async () => {
  const id = await channelOf("public");
  const a = connectAs(harness, id, alice.id);
  await synced(a.provider);
  const before = harness.authorizations.length;

  await setAccess(id, "public");
  await sleep(100);
  expect(harness.authorizations.length).toBe(before);
});

test("transferring a channel closes the old owner's private canvas", async () => {
  const id = await channelOf("private");
  await addChannelMemberByHandle(id, bob.handle);
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  await Promise.all([synced(a.provider), synced(b.provider)]);

  await transferChannel(id, bob.ownerId);

  await waitFor(closedWith(a, CLOSE_ACCESS_REVOKED), "alice's socket to close");
  await sleep(100);
  expect(b.closes).toEqual([]);
  expect(accessOf(b)).toBe("write");
});

test("group changes reach their members' canvases on the group's channels", async () => {
  const g = await createGroup({
    handle: `presence-${Date.now()}`,
    name: "Presence",
    created_by: alice.id,
  });
  try {
    await addGroupMemberByHandle(g.id, bob.handle, "admin");
    const priv = await channelOf("private", g.id);
    const pub = await channelOf("public", g.id);
    const bPriv = connectAs(harness, priv, bob.id);
    const bPub = connectAs(harness, pub, bob.id);
    const aPub = connectAs(harness, pub, alice.id);
    await Promise.all([bPriv, bPub, aPub].map((c) => synced(c.provider)));
    await waitFor(() => accessOf(bPub) === "write", "bob to start as an editor");

    // Admin to member: both tiers contribute, so the sockets are re-checked
    // and keep write.
    const before = harness.authorizations.length;
    await setGroupRole(g.id, bob.id, "member");
    await waitFor(() => harness.authorizations.length >= before + 2, "bob's re-checks");
    await sleep(50);
    expect(bPriv.closes).toEqual([]);
    expect(accessOf(bPub)).toBe("write");

    await removeGroupMember(g.id, bob.id);

    await waitFor(closedWith(bPriv, CLOSE_ACCESS_REVOKED), "the private canvas to close");
    await waitFor(() => accessOf(bPub) === "read", "the public canvas to go read-only");
    await expectEditDropped(pub, bPub, aPub, "after-leaving");
  } finally {
    await deleteGroup(g.id);
  }
});

test("banning a user drops them to read-only on public canvases and closes private ones", async () => {
  const open = await channelOf("open");
  const priv = await channelOf("private");
  await addChannelMemberByHandle(priv, bob.handle);
  const aOpen = connectAs(harness, open, alice.id);
  const bOpen = connectAs(harness, open, bob.id);
  const bPriv = connectAs(harness, priv, bob.id);
  await Promise.all([aOpen, bOpen, bPriv].map((c) => synced(c.provider)));
  await waitFor(() => accessOf(bOpen) === "write", "bob to start as an editor");

  try {
    await setUserBanned(bob.id, true);

    await waitFor(closedWith(bPriv, CLOSE_ACCESS_REVOKED), "the private canvas to close");
    await waitFor(() => accessOf(bOpen) === "read", "the open canvas to go read-only");
    await expectEditDropped(open, bOpen, aOpen, "after-ban");
  } finally {
    await setUserBanned(bob.id, false);
  }
});

test("deleting a group closes open canvases on the channels it took with it", async () => {
  const g = await createGroup({
    handle: `presence-doomed-${Date.now()}`,
    name: "Doomed",
    created_by: alice.id,
  });
  const ch = await createChannel({ title: "Doomed canvas", access: "public", owned_by: g.id });
  const a = connectAs(harness, ch.id, alice.id);
  const anon = connectAs(harness, ch.id, null);
  // Nothing unsaved, so no failing save would close the room by accident.
  await Promise.all([synced(a.provider), synced(anon.provider)]);

  await deleteGroup(g.id);

  await waitFor(closedWith(a, CLOSE_CHANNEL_GONE), "alice's socket to close");
  await waitFor(closedWith(anon, CLOSE_CHANNEL_GONE), "the reader's socket to close");
  await waitFor(() => harness.canvas.roomCount() === 0, "the room to unload");
});

test("a permission change while a socket is being authorized still reaches it", async () => {
  const id = await channelOf("private");
  await addChannelMemberByHandle(id, bob.handle);
  const a = connectAs(harness, id, alice.id);
  await synced(a.provider);

  // Bob's authorize reads the database, then answers late, after he's been
  // removed: the answer he joins with is stale.
  harness.delayAuthorizeMs = 200;
  const b = connectAs(harness, id, bob.id);
  await sleep(80);
  await removeChannelMember(id, bob.id);
  await sleep(150);
  harness.delayAuthorizeMs = 0;

  await waitFor(closedWith(b, CLOSE_ACCESS_REVOKED), "bob's socket to close");
  expect(elementsOf(a.doc).size).toBe(0);
});

test("a re-check that can't reach authorize closes the socket so it reconnects", async () => {
  const id = await channelOf("public");
  const a = connectAs(harness, id, alice.id);
  await synced(a.provider);

  harness.failAuthorize = true;
  await setAccess(id, "open");
  await waitFor(closedWith(a, 1011), "the socket to close with 1011");
  harness.failAuthorize = false;

  // 1011 is retried, and the reconnect authorizes from scratch.
  await waitFor(() => a.provider.wsconnected, "the provider to reconnect", 5000);
  await waitFor(() => accessOf(a) === "write", "a fresh session event");
});

test("offline edits from an editor merge on reconnect", async () => {
  const id = await channelOf("public");
  await addChannelMemberByHandle(id, bob.handle);
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  await Promise.all([synced(a.provider), synced(b.provider)]);

  b.provider.disconnect();
  addShape(b.doc, "offline-bob");
  addShape(a.doc, "online-alice");
  await sleep(50);
  b.provider.connect();

  const both = (c: Client) =>
    elementsOf(c.doc).has("offline-bob") && elementsOf(c.doc).has("online-alice");
  await waitFor(() => both(a) && both(b), "both edits on both clients");
  await waitFor(() => harness.canvas.roomCount() === 1, "the room");
  await sleep(150);
  expect(await storedHas(id, "offline-bob")).toBe(true);
});

test("offline edits from someone removed while offline never land", async () => {
  const priv = await channelOf("private");
  const pub = await channelOf("public");
  await addChannelMemberByHandle(priv, bob.handle);
  await addChannelMemberByHandle(pub, bob.handle);
  const aPriv = connectAs(harness, priv, alice.id);
  const aPub = connectAs(harness, pub, alice.id);
  const bPriv = connectAs(harness, priv, bob.id);
  const bPub = connectAs(harness, pub, bob.id);
  await Promise.all([aPriv, aPub, bPriv, bPub].map((c) => synced(c.provider)));

  bPriv.provider.disconnect();
  bPub.provider.disconnect();
  addShape(bPriv.doc, "offline-private");
  addShape(bPub.doc, "offline-public");
  await removeChannelMember(priv, bob.id);
  await removeChannelMember(pub, bob.id);
  bPriv.provider.connect();
  bPub.provider.connect();

  // Private: refused with 4403 after the handshake, and the provider stops.
  await waitFor(closedWith(bPriv, CLOSE_ACCESS_REVOKED), "the private reconnect to be refused");
  await sleep(150);
  expect(bPriv.provider.shouldConnect).toBe(false);
  expect(elementsOf(aPriv.doc).has("offline-private")).toBe(false);
  expect(await storedHas(priv, "offline-private")).toBe(false);

  // Public: back as a reader, whose sync reply carrying the edit is dropped.
  await waitFor(() => accessOf(bPub) === "read", "the public reconnect to be read-only");
  await expectEditDropped(pub, bPub, aPub, "after-reconnect");
  expect(elementsOf(aPub.doc).has("offline-public")).toBe(false);
  expect(await storedHas(pub, "offline-public")).toBe(false);
});
