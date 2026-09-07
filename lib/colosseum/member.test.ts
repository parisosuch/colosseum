import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { createChannel, getMemberChannels, viewerScope } from "./channel";
import {
  addChannelMemberByHandle,
  isChannelMember,
  listChannelMembers,
  removeChannelMember,
} from "./member";

beforeAll(async () => {
  await seed();
});

test("add by handle, then isChannelMember and listChannelMembers reflect it", async () => {
  const ch = await createChannel({
    title: "Group",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });

  expect(await isChannelMember(ch.id, USERS.alice.id)).toBe(false);

  const member = await addChannelMemberByHandle(ch.id, USERS.alice.handle);
  expect(member.user_id).toBe(USERS.alice.id);
  expect(member.handle).toBe(USERS.alice.handle);

  expect(await isChannelMember(ch.id, USERS.alice.id)).toBe(true);
  expect((await listChannelMembers(ch.id)).map((m) => m.handle)).toContain(USERS.alice.handle);
});

test("adding an existing member is idempotent (no duplicate row)", async () => {
  const ch = await createChannel({
    title: "Group2",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  await addChannelMemberByHandle(ch.id, USERS.alice.handle);
  await addChannelMemberByHandle(ch.id, USERS.alice.handle);
  expect(await listChannelMembers(ch.id)).toHaveLength(1);
});

test("removeChannelMember revokes access", async () => {
  const ch = await createChannel({
    title: "Group3",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  await addChannelMemberByHandle(ch.id, USERS.alice.handle);
  await removeChannelMember(ch.id, USERS.alice.id);
  expect(await isChannelMember(ch.id, USERS.alice.id)).toBe(false);
});

test("getMemberChannels lists joined channels (with owner handle), not owned ones, and leaving drops them", async () => {
  // Bob owns a channel Alice joins; Alice also owns one herself.
  const bobs = await createChannel({
    title: "Bob's Group",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  const alices = await createChannel({
    title: "Alice Own",
    access: "private",
    owned_by: USERS.alice.ownerId,
  });
  await addChannelMemberByHandle(bobs.id, USERS.alice.handle);

  const before = await getMemberChannels(await viewerScope(USERS.alice.id));
  const joined = before.find((c) => c.id === bobs.id);
  expect(joined).toBeDefined();
  expect(joined!.handle).toBe(USERS.bob.handle); // owner's handle, for the link
  // A channel she owns is never a "member of" entry.
  expect(before.some((c) => c.id === alices.id)).toBe(false);

  // Leaving removes it from the list.
  await removeChannelMember(bobs.id, USERS.alice.id);
  expect(
    (await getMemberChannels(await viewerScope(USERS.alice.id))).some((c) => c.id === bobs.id),
  ).toBe(false);
});

test("adding an unknown handle throws", async () => {
  const ch = await createChannel({
    title: "Group4",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  expect(addChannelMemberByHandle(ch.id, "nobody-here")).rejects.toThrow(
    "No user with that handle.",
  );
});
