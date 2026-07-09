import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { createChannel } from "./channel";
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
  const ch = await createChannel({ title: "Group", access: "private", owner_id: USERS.bob.id });

  expect(await isChannelMember(ch.id, USERS.alice.id)).toBe(false);

  const member = await addChannelMemberByHandle(ch.id, USERS.alice.handle);
  expect(member.user_id).toBe(USERS.alice.id);
  expect(member.handle).toBe(USERS.alice.handle);

  expect(await isChannelMember(ch.id, USERS.alice.id)).toBe(true);
  expect((await listChannelMembers(ch.id)).map((m) => m.handle)).toContain(USERS.alice.handle);
});

test("adding an existing member is idempotent (no duplicate row)", async () => {
  const ch = await createChannel({ title: "Group2", access: "private", owner_id: USERS.bob.id });
  await addChannelMemberByHandle(ch.id, USERS.alice.handle);
  await addChannelMemberByHandle(ch.id, USERS.alice.handle);
  expect(await listChannelMembers(ch.id)).toHaveLength(1);
});

test("removeChannelMember revokes access", async () => {
  const ch = await createChannel({ title: "Group3", access: "private", owner_id: USERS.bob.id });
  await addChannelMemberByHandle(ch.id, USERS.alice.handle);
  await removeChannelMember(ch.id, USERS.alice.id);
  expect(await isChannelMember(ch.id, USERS.alice.id)).toBe(false);
});

test("adding an unknown handle throws", async () => {
  const ch = await createChannel({ title: "Group4", access: "private", owner_id: USERS.bob.id });
  expect(addChannelMemberByHandle(ch.id, "nobody-here")).rejects.toThrow(
    "No user with that handle.",
  );
});
