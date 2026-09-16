import { beforeAll, expect, test } from "bun:test";

import { GROUPS, seed, USERS } from "@/scripts/seed";
import {
  canManageChannel,
  canReadChannel,
  createChannel,
  deleteChannel,
  getChannel,
  resolveChannelViewer,
  transferChannel,
} from "./channel";
import { setGroupRole } from "./group";

beforeAll(async () => {
  await seed();
});

// Moving a channel between owners is the one mutation that changes who can read
// something without touching the channel itself, so these check the access that
// follows the move rather than just the column.
test("moving a private channel into a group opens it to the group's members", async () => {
  const ch = await createChannel({
    title: "Moving in",
    access: "private",
    owned_by: USERS.alice.ownerId,
  });
  try {
    // Bob is in the studio group but has nothing to do with alice's channel.
    expect(canReadChannel(ch, await resolveChannelViewer(ch, USERS.bob.id))).toBe(false);

    const moved = await transferChannel(ch.id, GROUPS.studio.id);
    expect(moved.owned_by).toBe(GROUPS.studio.id);
    expect(canReadChannel(moved, await resolveChannelViewer(moved, USERS.bob.id))).toBe(true);
  } finally {
    await deleteChannel(ch.id);
  }
});

test("moving a private channel back out closes it to the group again", async () => {
  const ch = await createChannel({
    title: "Moving out",
    access: "private",
    owned_by: GROUPS.studio.id,
  });
  try {
    expect(canReadChannel(ch, await resolveChannelViewer(ch, USERS.bob.id))).toBe(true);

    const moved = await transferChannel(ch.id, USERS.alice.ownerId);
    expect(canReadChannel(moved, await resolveChannelViewer(moved, USERS.bob.id))).toBe(false);
    // Alice, who it went to, can still read it.
    expect(canReadChannel(moved, await resolveChannelViewer(moved, USERS.alice.id))).toBe(true);
  } finally {
    await deleteChannel(ch.id);
  }
});

// The cached channel row carries owned_by, so a move that forgot to invalidate
// would keep serving the old owner and with it the old access.
test("a moved channel reads back with its new owner, not a cached one", async () => {
  const ch = await createChannel({
    title: "Cache check",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  try {
    // Warm the cache under the old owner first.
    expect((await getChannel(ch.id))?.owned_by).toBe(USERS.alice.ownerId);
    await transferChannel(ch.id, GROUPS.studio.id);
    expect((await getChannel(ch.id))?.owned_by).toBe(GROUPS.studio.id);
  } finally {
    await deleteChannel(ch.id);
  }
});

// A group's admin manages its channels, so a channel moved in becomes theirs to
// manage without anyone touching the channel's own roster.
test("a group admin can manage a channel moved into the group", async () => {
  const ch = await createChannel({
    title: "Admin reach",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  await setGroupRole(GROUPS.studio.id, USERS.bob.id, "admin");
  try {
    expect(canManageChannel(ch, await resolveChannelViewer(ch, USERS.bob.id))).toBe(false);
    const moved = await transferChannel(ch.id, GROUPS.studio.id);
    expect(canManageChannel(moved, await resolveChannelViewer(moved, USERS.bob.id))).toBe(true);
  } finally {
    await setGroupRole(GROUPS.studio.id, USERS.bob.id, "member");
    await deleteChannel(ch.id);
  }
});
