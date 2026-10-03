import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";

import * as encoding from "lib0/encoding";

import { createChannel, deleteChannel, type ChannelAccess } from "@/lib/colosseum/channel";
import { seed, USERS } from "@/scripts/seed";
import { PRESENCE_COLORS, presenceColor, presenceFor } from "./canvas-presence";
import {
  connectAs,
  destroyClients,
  lastSession,
  sleep,
  startHarness,
  synced,
  waitFor,
  type Harness,
} from "./canvas-test-harness";
import { MESSAGE_AWARENESS } from "./protocol";

const alice = USERS.alice;
const bob = USERS.bob;

let harness: Harness;
const channels: number[] = [];

async function channelOf(access: ChannelAccess): Promise<number> {
  const ch = await createChannel({
    title: `Presence ${access} ${channels.length}`,
    access,
    owned_by: alice.ownerId,
  });
  channels.push(ch.id);
  return ch.id;
}

// A raw awareness message, the way a client that ignores y-websocket's
// Awareness class could send one.
function awarenessMessage(entries: { clientId: number; clock: number; state: unknown }[]) {
  const update = encoding.createEncoder();
  encoding.writeVarUint(update, entries.length);
  for (const e of entries) {
    encoding.writeVarUint(update, e.clientId);
    encoding.writeVarUint(update, e.clock);
    encoding.writeVarString(update, JSON.stringify(e.state));
  }
  const message = encoding.createEncoder();
  encoding.writeVarUint(message, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(message, encoding.toUint8Array(update));
  return encoding.toUint8Array(message);
}

beforeAll(async () => {
  await seed();
});

afterAll(async () => {
  for (const id of channels) await deleteChannel(id);
});

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  destroyClients();
  await harness.close();
});

test("a user's colour is stable and comes from the palette", () => {
  expect(presenceColor(alice.id)).toBe(presenceColor(alice.id));
  expect(PRESENCE_COLORS).toContain(presenceColor(alice.id) as (typeof PRESENCE_COLORS)[number]);
  // Ten users spread over more than one colour.
  const ids = Array.from({ length: 10 }, (_, i) => `user-${i}`);
  expect(new Set(ids.map(presenceColor)).size).toBeGreaterThan(1);
});

test("the palette is the design's eight tokens, and user ids reach all of them", () => {
  expect([...PRESENCE_COLORS]).toEqual([
    "violet",
    "orange",
    "teal",
    "blue",
    "pink",
    "lime",
    "fuchsia",
    "cyan",
  ]);
  const ids = Array.from(
    { length: 200 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  expect(new Set(ids.map(presenceColor)).size).toBe(8);
});

test("only editors get a presence identity", () => {
  expect(presenceFor({ access: "read", userId: alice.id, handle: "alice" })).toBeNull();
  expect(presenceFor({ access: "write", userId: null })).toBeNull();
  expect(presenceFor({ access: "write", userId: alice.id, handle: null })?.name).toBe("Someone");
});

test("an editor is told its access and identity when it joins", async () => {
  const id = await channelOf("public");
  const a = connectAs(harness, id, alice.id);
  await synced(a.provider);
  await waitFor(() => !!lastSession(a), "the session event");
  expect(lastSession(a)).toEqual({
    type: "session",
    access: "write",
    user: {
      id: alice.id,
      handle: alice.handle,
      name: alice.handle,
      avatarUrl: null,
      color: presenceColor(alice.id),
    },
  });
});

test("the server sets each editor's identity and a client can't override it", async () => {
  const id = await channelOf("open");
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  await Promise.all([synced(a.provider), synced(b.provider)]);

  // Bob claims to be alice, in her colour.
  b.provider.awareness.setLocalState({
    user: { id: alice.id, handle: "alice", name: "alice", color: presenceColor(alice.id) },
    cursor: { x: 5, y: 6 },
  });

  const bobId = b.doc.clientID;
  await waitFor(() => a.provider.awareness.getStates().get(bobId)?.cursor?.x === 5, "bob's cursor");
  const seen = a.provider.awareness.getStates().get(bobId)!;
  expect(seen.user).toEqual({
    id: bob.id,
    handle: bob.handle,
    name: bob.handle,
    avatarUrl: null,
    color: presenceColor(bob.id),
  });
  // The client's own fields pass through untouched.
  expect(seen.cursor).toEqual({ x: 5, y: 6 });
});

test("an editor can't write or remove another editor's presence", async () => {
  const id = await channelOf("open");
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  const watcher = connectAs(harness, id, null);
  await Promise.all([synced(a.provider), synced(b.provider), synced(watcher.provider)]);

  a.provider.awareness.setLocalStateField("cursor", { x: 1, y: 1 });
  const aliceId = a.doc.clientID;
  const aliceOn = () => watcher.provider.awareness.getStates().get(aliceId);
  await waitFor(() => aliceOn()?.cursor?.x === 1, "alice's cursor on the watcher");

  // Bob forges an update for alice's client id with a far-ahead clock: once to
  // move her cursor, once to remove her.
  b.provider.ws!.send(
    awarenessMessage([{ clientId: aliceId, clock: 1000, state: { cursor: { x: 99, y: 99 } } }]),
  );
  b.provider.ws!.send(awarenessMessage([{ clientId: aliceId, clock: 1001, state: null }]));

  // Bob's own cursor arriving afterwards shows the server handled both.
  b.provider.awareness.setLocalStateField("cursor", { x: 2, y: 2 });
  await waitFor(
    () => watcher.provider.awareness.getStates().get(b.doc.clientID)?.cursor?.x === 2,
    "bob's cursor on the watcher",
  );
  expect(aliceOn()?.cursor).toEqual({ x: 1, y: 1 });
  expect(aliceOn()?.user?.id).toBe(alice.id);
});

test("a signed-in reader is told it's read-only and never shows up in presence", async () => {
  // Public channel: bob reads it but only alice contributes.
  const id = await channelOf("public");
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  await Promise.all([synced(a.provider), synced(b.provider)]);
  await waitFor(() => !!lastSession(b), "bob's session event");
  expect(lastSession(b)).toEqual({ type: "session", access: "read", user: null });

  b.provider.awareness.setLocalStateField("cursor", { x: 3, y: 3 });
  // Forged too, for a client id nobody holds.
  b.provider.ws!.send(
    awarenessMessage([{ clientId: 424242, clock: 1, state: { cursor: { x: 4, y: 4 } } }]),
  );
  a.provider.awareness.setLocalStateField("cursor", { x: 1, y: 1 });
  await waitFor(
    () => b.provider.awareness.getStates().get(a.doc.clientID)?.cursor?.x === 1,
    "alice's cursor on bob",
  );
  await sleep(50);
  const onAlice = [...a.provider.awareness.getStates().keys()];
  expect(onAlice).toEqual([a.doc.clientID]);
});

test("an editor whose socket drops leaves everyone else's presence", async () => {
  const id = await channelOf("open");
  const a = connectAs(harness, id, alice.id);
  const b = connectAs(harness, id, bob.id);
  const watcher = connectAs(harness, id, null);
  await Promise.all([synced(a.provider), synced(b.provider), synced(watcher.provider)]);
  b.provider.awareness.setLocalStateField("cursor", { x: 1, y: 1 });
  const bobId = b.doc.clientID;
  await waitFor(() => a.provider.awareness.getStates().has(bobId), "bob on alice");
  await waitFor(() => watcher.provider.awareness.getStates().has(bobId), "bob on the watcher");

  // Drop the socket without the null state a clean disconnect would send, and
  // keep the provider from reconnecting.
  b.provider.shouldConnect = false;
  b.provider.ws!.close();

  await waitFor(() => !a.provider.awareness.getStates().has(bobId), "bob to leave alice");
  await waitFor(
    () => !watcher.provider.awareness.getStates().has(bobId),
    "bob to leave the watcher",
  );
});
