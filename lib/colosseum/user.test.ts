import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { getPublicUserProfile, getUserProfile } from "./user";

beforeAll(async () => {
  await seed();
});

test("getPublicUserProfile resolves a handle to its profile", async () => {
  const profile = await getPublicUserProfile(USERS.alice.handle);
  expect(profile?.user_id).toBe(USERS.alice.id);
  expect(profile?.handle).toBe(USERS.alice.handle);
});

test("getPublicUserProfile returns null for an unknown handle", async () => {
  expect(await getPublicUserProfile("nobody-here")).toBeNull();
});

test("getUserProfile resolves a user id to its profile", async () => {
  expect((await getUserProfile(USERS.bob.id))?.handle).toBe(USERS.bob.handle);
});
