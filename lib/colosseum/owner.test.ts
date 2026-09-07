import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { canManageChannel, createChannel, deleteChannel, viewerScope } from "./channel";
import {
  getOwner,
  getOwnerByHandle,
  ownerIdForUser,
  ownerRecipients,
  requireOwnerId,
} from "./owner";
import { createUserProfile, getPublicUserProfile, getUserProfile, HandleTakenError } from "./user";

beforeAll(async () => {
  await seed();
});

// The invariant the whole owner split rests on. If these two ever compare equal
// the ownership checks would start passing for the wrong reason, and every
// `owned_by === userId` bug this rename was meant to expose becomes invisible.
test("a person's owner id is not their user id", async () => {
  const ownerId = await ownerIdForUser(USERS.alice.id);
  expect(ownerId).toBe(USERS.alice.ownerId);
  expect(ownerId).not.toBe(USERS.alice.id);
});

test("getOwnerByHandle resolves a handle, and getOwner round-trips the id", async () => {
  const byHandle = await getOwnerByHandle(USERS.bob.handle);
  expect(byHandle?.id).toBe(USERS.bob.ownerId);
  expect(byHandle?.kind).toBe("user");
  expect(byHandle?.user_id).toBe(USERS.bob.id);

  expect((await getOwner(USERS.bob.ownerId))?.handle).toBe(USERS.bob.handle);
  expect(await getOwnerByHandle("nobody-here")).toBeNull();
});

test("ownerIdForUser and getOwnerByHandle return null rather than throwing", async () => {
  expect(await ownerIdForUser("99999999-9999-4999-8999-999999999999")).toBeNull();
  expect(await getOwner("99999999-9999-4999-8999-999999999999")).toBeNull();
});

test("requireOwnerId names the fix instead of reporting a missing row", async () => {
  expect(requireOwnerId("99999999-9999-4999-8999-999999999999")).rejects.toThrow(
    /Finish setting up your profile/,
  );
});

// A notification's recipient is a user_id, so anything addressed to "the owner"
// has to come back through here as a person.
test("ownerRecipients maps an owner back to the people behind it", async () => {
  expect(await ownerRecipients(USERS.alice.ownerId)).toEqual([USERS.alice.id]);
  expect(await ownerRecipients("99999999-9999-4999-8999-999999999999")).toEqual([]);
});

// Guards the specific mistake the rename exists to prevent: a caller that hands
// canManageChannel a session's user id where an owner id belongs. It has to deny,
// not accidentally allow.
test("canManageChannel denies a viewer carrying a user id in place of an owner id", async () => {
  const ch = await createChannel({
    title: "Owner check",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  try {
    expect(canManageChannel(ch, await viewerScope(USERS.alice.id))).toBe(true);
    // The same person, described wrongly.
    expect(canManageChannel(ch, { userId: USERS.alice.id, ownerId: USERS.alice.id })).toBe(false);
    // Someone else, and a signed-out viewer whose null owner id must not match.
    expect(canManageChannel(ch, await viewerScope(USERS.bob.id))).toBe(false);
    expect(canManageChannel(ch, { userId: null, ownerId: null })).toBe(false);
  } finally {
    await deleteChannel(ch.id);
  }
});

test("a profile spans the owner row and the settings row, and reports both ids", async () => {
  const profile = await getPublicUserProfile(USERS.alice.handle);
  expect(profile?.user_id).toBe(USERS.alice.id);
  expect(profile?.owner_id).toBe(USERS.alice.ownerId);
  expect(profile?.about).toBe(USERS.alice.about);
  // The notification prefs come from user_profile, so an inner join that missed
  // would surface here rather than as a null field somewhere downstream.
  expect(profile?.email_notifications.comment).toBe(true);

  expect((await getUserProfile(USERS.alice.id))?.handle).toBe(USERS.alice.handle);
});

// createUserProfile writes an owner row and a user_profile row together. A taken
// handle must leave neither behind, or the next attempt hits a half-made person.
test("createUserProfile rolls both rows back when the handle is taken", async () => {
  const userId = USERS.bob.id;
  expect(createUserProfile(userId, USERS.alice.handle)).rejects.toBeInstanceOf(HandleTakenError);
  // Bob still has exactly the profile he started with — no second owner row, and
  // his own handle untouched.
  const profile = await getUserProfile(userId);
  expect(profile?.handle).toBe(USERS.bob.handle);
  expect(profile?.owner_id).toBe(USERS.bob.ownerId);
});
