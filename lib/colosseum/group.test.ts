import { beforeAll, expect, test } from "bun:test";

import { GROUP_CHANNELS, GROUPS, seed, USERS } from "@/scripts/seed";
import {
  canContributeChannel,
  canManageChannel,
  canReadChannel,
  createChannel,
  getChannel,
  getOwnerChannels,
  getVisibleOwnerChannels,
  resolveChannelViewer,
  searchChannels,
  SIGNED_OUT,
  viewerScope,
} from "./channel";
import {
  addGroupMemberByHandle,
  createGroup,
  deleteGroup,
  getGroup,
  getGroupByHandle,
  groupRecipients,
  groupRole,
  listGroupMembers,
  listUserGroups,
  removeGroupMember,
  setGroupRole,
  transferGroupOwnership,
} from "./group";
import { ownerRecipients } from "./owner";
import { HandleTakenError } from "./user";

beforeAll(async () => {
  await seed();
});

async function studioChannel(title: string) {
  const chs = await getOwnerChannels(GROUPS.studio.id);
  const ch = chs.find((c) => c.title === title);
  if (!ch) throw new Error(`seed is missing the group channel ${title}`);
  return ch;
}

test("a group is an owner row plus a group row, reachable by id and by handle", async () => {
  const byId = await getGroup(GROUPS.studio.id);
  expect(byId?.handle).toBe(GROUPS.studio.handle);
  expect(byId?.name).toBe(GROUPS.studio.name);
  expect((await getGroupByHandle(GROUPS.studio.handle))?.id).toBe(GROUPS.studio.id);
});

// The whole point of one handle namespace: a group cannot take a person's
// handle, and Postgres is what refuses it rather than a check that could race.
test("a group cannot take a handle a person already has", async () => {
  expect(
    createGroup({ handle: USERS.alice.handle, name: "Impostor", created_by: USERS.bob.id }),
  ).rejects.toBeInstanceOf(HandleTakenError);
});

test("the roster carries roles, owners first", async () => {
  const members = await listGroupMembers(GROUPS.studio.id);
  expect(members.map((m) => [m.handle, m.role])).toEqual([
    [USERS.alice.handle, "owner"],
    [USERS.bob.handle, "member"],
  ]);
});

test("groupRole answers for members and outsiders alike", async () => {
  expect(await groupRole(GROUPS.studio.id, USERS.alice.id)).toBe("owner");
  expect(await groupRole(GROUPS.studio.id, USERS.bob.id)).toBe("member");
  expect(await groupRole(GROUPS.studio.id, "99999999-9999-4999-8999-999999999999")).toBeNull();
});

// ---------------------------------------------------------------------------
// The authorization matrix, which is what the roles are for.
// ---------------------------------------------------------------------------

test("a group's owner manages its channels; a plain member only contributes", async () => {
  const ch = await studioChannel(GROUP_CHANNELS.studioPublic.title);

  const owner = await resolveChannelViewer(ch, USERS.alice.id);
  expect(canManageChannel(ch, owner)).toBe(true);
  expect(canContributeChannel(ch, owner)).toBe(true);

  // The distinction the middle tier exists for: bob may add blocks to the
  // group's channel but may not rename or delete it.
  const member = await resolveChannelViewer(ch, USERS.bob.id);
  expect(canContributeChannel(ch, member)).toBe(true);
  expect(canManageChannel(ch, member)).toBe(false);
});

test("an admin manages the group's channels, which a member cannot", async () => {
  const ch = await studioChannel(GROUP_CHANNELS.studioPublic.title);
  await setGroupRole(GROUPS.studio.id, USERS.bob.id, "admin");
  try {
    const asAdmin = await resolveChannelViewer(ch, USERS.bob.id);
    expect(canManageChannel(ch, asAdmin)).toBe(true);
  } finally {
    await setGroupRole(GROUPS.studio.id, USERS.bob.id, "member");
  }
  // ...and demoting takes it straight back away.
  expect(canManageChannel(ch, await resolveChannelViewer(ch, USERS.bob.id))).toBe(false);
});

test("a group's private channel reads for its members and nobody else", async () => {
  const ch = await studioChannel(GROUP_CHANNELS.studioPrivate.title);
  expect(ch.access).toBe("private");

  // No channel_member row exists for either of them — the group roster is what
  // grants this, which is the replacement the roles are meant to be.
  expect(canReadChannel(ch, await resolveChannelViewer(ch, USERS.alice.id))).toBe(true);
  expect(canReadChannel(ch, await resolveChannelViewer(ch, USERS.bob.id))).toBe(true);

  const outsider = await resolveChannelViewer(ch, "99999999-9999-4999-8999-999999999999");
  expect(canReadChannel(ch, outsider)).toBe(false);
  expect(canReadChannel(ch, { ...SIGNED_OUT, isChannelMember: false })).toBe(false);
});

test("a signed-out viewer sees a group's public channel and not its private one", async () => {
  const titles = (await getVisibleOwnerChannels(GROUPS.studio.id, SIGNED_OUT)).map((c) => c.title);
  expect(titles).toContain(GROUP_CHANNELS.studioPublic.title);
  expect(titles).not.toContain(GROUP_CHANNELS.studioPrivate.title);
});

test("a member sees the group's private channel on its profile, an outsider does not", async () => {
  const asMember = (
    await getVisibleOwnerChannels(GROUPS.studio.id, await viewerScope(USERS.bob.id))
  ).map((c) => c.title);
  expect(asMember).toContain(GROUP_CHANNELS.studioPrivate.title);

  const outsider = await viewerScope("99999999-9999-4999-8999-999999999999");
  const asOutsider = (await getVisibleOwnerChannels(GROUPS.studio.id, outsider)).map(
    (c) => c.title,
  );
  expect(asOutsider).not.toContain(GROUP_CHANNELS.studioPrivate.title);
});

// The list queries and the row predicate share isVisibleSql, so this is the
// check that they agree — search is the one a viewer notices leaking.
test("search surfaces a group's private channel to a member, never to an outsider", async () => {
  const asMember = await searchChannels(
    await viewerScope(USERS.bob.id),
    GROUP_CHANNELS.studioPrivate.title,
  );
  expect(asMember.map((c) => c.title)).toContain(GROUP_CHANNELS.studioPrivate.title);
  expect(asMember.find((c) => c.title === GROUP_CHANNELS.studioPrivate.title)?.handle).toBe(
    GROUPS.studio.handle,
  );

  const outsider = await viewerScope("99999999-9999-4999-8999-999999999999");
  const hits = await searchChannels(outsider, GROUP_CHANNELS.studioPrivate.title);
  expect(hits.map((c) => c.title)).not.toContain(GROUP_CHANNELS.studioPrivate.title);
});

test("leaving a group takes its channels away with it", async () => {
  const ch = await studioChannel(GROUP_CHANNELS.studioPrivate.title);
  expect(canReadChannel(ch, await resolveChannelViewer(ch, USERS.bob.id))).toBe(true);
  await removeGroupMember(GROUPS.studio.id, USERS.bob.id);
  try {
    expect(canReadChannel(ch, await resolveChannelViewer(ch, USERS.bob.id))).toBe(false);
  } finally {
    await addGroupMemberByHandle(GROUPS.studio.id, USERS.bob.handle, "member");
  }
});

// ---------------------------------------------------------------------------
// The invariants that keep a group administrable.
// ---------------------------------------------------------------------------

test("a group always keeps exactly one owner", async () => {
  // Removing the owner is refused — no constraint can catch it, since a delete
  // leaves no row for one to fire on.
  expect(removeGroupMember(GROUPS.studio.id, USERS.alice.id)).rejects.toThrow(/Transfer ownership/);
  // So is demoting them, and so is adding a second owner.
  expect(setGroupRole(GROUPS.studio.id, USERS.alice.id, "admin")).rejects.toThrow(
    /Transfer ownership/,
  );
  expect(
    addGroupMemberByHandle(GROUPS.studio.id, USERS.bob.handle, "owner" as never),
  ).rejects.toThrow(/Transfer ownership/);
  expect((await listGroupMembers(GROUPS.studio.id)).filter((m) => m.role === "owner")).toHaveLength(
    1,
  );
});

test("transferring ownership swaps the two roles and never leaves two owners", async () => {
  await transferGroupOwnership(GROUPS.studio.id, USERS.alice.id, USERS.bob.id);
  try {
    expect(await groupRole(GROUPS.studio.id, USERS.bob.id)).toBe("owner");
    // The previous owner keeps managing rights, but not the owner role.
    expect(await groupRole(GROUPS.studio.id, USERS.alice.id)).toBe("admin");
    const owners = (await listGroupMembers(GROUPS.studio.id)).filter((m) => m.role === "owner");
    expect(owners).toHaveLength(1);
  } finally {
    await transferGroupOwnership(GROUPS.studio.id, USERS.bob.id, USERS.alice.id);
    await setGroupRole(GROUPS.studio.id, USERS.bob.id, "member");
  }
});

test("ownership cannot be handed to someone outside the group", async () => {
  expect(
    transferGroupOwnership(
      GROUPS.studio.id,
      USERS.alice.id,
      "99999999-9999-4999-8999-999999999999",
    ),
  ).rejects.toThrow(/not in this group/);
});

test("re-adding an existing member leaves their role alone", async () => {
  await setGroupRole(GROUPS.studio.id, USERS.bob.id, "admin");
  try {
    const again = await addGroupMemberByHandle(GROUPS.studio.id, USERS.bob.handle, "member");
    expect(again.role).toBe("admin");
    expect(await groupRole(GROUPS.studio.id, USERS.bob.id)).toBe("admin");
  } finally {
    await setGroupRole(GROUPS.studio.id, USERS.bob.id, "member");
  }
});

// ---------------------------------------------------------------------------
// Notifications and lifecycle.
// ---------------------------------------------------------------------------

// A notification's recipient is a user id, so a group has to resolve to people.
test("a group notifies its managers, not its whole roster", async () => {
  expect(await groupRecipients(GROUPS.studio.id)).toEqual([USERS.alice.id]);
  // ownerRecipients is the seam the connect notification goes through, and it
  // has to give the same answer for a group as groupRecipients does.
  expect(await ownerRecipients(GROUPS.studio.id)).toEqual([USERS.alice.id]);
  // A personal owner still resolves to that one person.
  expect(await ownerRecipients(USERS.alice.ownerId)).toEqual([USERS.alice.id]);
});

test("listUserGroups reports each membership with its role", async () => {
  const alices = await listUserGroups(USERS.alice.id);
  expect(alices.map((g) => [g.handle, g.role])).toContainEqual([GROUPS.studio.handle, "owner"]);
  const bobs = await listUserGroups(USERS.bob.id);
  expect(bobs.map((g) => [g.handle, g.role])).toContainEqual([GROUPS.studio.handle, "member"]);
});

test("creating a group makes its creator the owner", async () => {
  const g = await createGroup({ handle: "kiln-test", name: "Kiln", created_by: USERS.bob.id });
  try {
    expect(await groupRole(g.id, USERS.bob.id)).toBe("owner");
    expect(await listGroupMembers(g.id)).toHaveLength(1);
  } finally {
    await deleteGroup(g.id);
  }
});

// Deleting a group must take its channels, the way deleting a person does.
test("deleting a group deletes the channels it owned", async () => {
  const g = await createGroup({ handle: "kiln-doomed", name: "Doomed", created_by: USERS.bob.id });
  const ch = await createChannel({ title: "Group's own", access: "public", owned_by: g.id });
  await deleteGroup(g.id);
  expect(await getGroup(g.id)).toBeNull();
  // Asserted against the row itself, not a channel list, which is cached.
  expect(await getChannel(ch.id)).toBeNull();
});
