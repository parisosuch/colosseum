import { beforeAll, afterEach, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import {
  assertColumnQuota,
  assertInviteQuota,
  effectiveLimit,
  getAppSettings,
  getColumnQuota,
  getInviteQuota,
  listUsers,
  setUserAdmin,
  setUserBanned,
  setUserLimits,
  updateAppSettings,
} from "./admin";

beforeAll(async () => {
  await seed();
});

// Every mutating test resets shared state so it can't bleed into the next.
afterEach(async () => {
  await updateAppSettings({ max_invites_per_user: null, max_columns_per_user: null });
  await setUserLimits(USERS.bob.id, { invite_limit: null, column_limit: null });
  await setUserBanned(USERS.bob.id, false);
});

test("effectiveLimit prefers the per-user override, else the global", () => {
  expect(effectiveLimit(5, 10)).toBe(5);
  expect(effectiveLimit(0, 10)).toBe(0);
  expect(effectiveLimit(null, 10)).toBe(10);
  expect(effectiveLimit(null, null)).toBe(null);
});

test("app settings round-trip through the singleton row", async () => {
  await updateAppSettings({ max_invites_per_user: 3, max_columns_per_user: 7 });
  const s = await getAppSettings();
  expect(s.max_invites_per_user).toBe(3);
  expect(s.max_columns_per_user).toBe(7);
});

test("assertInviteQuota enforces the global limit for a non-admin", async () => {
  // Bob has no codes yet, so his used capacity is 0.
  await updateAppSettings({ max_invites_per_user: 2, max_columns_per_user: null });
  await expect(assertInviteQuota(USERS.bob.id, 2)).resolves.toBeUndefined();
  await expect(assertInviteQuota(USERS.bob.id, 3)).rejects.toThrow();
});

test("assertInviteQuota with a limit of 0 blocks all invites", async () => {
  await updateAppSettings({ max_invites_per_user: 0, max_columns_per_user: null });
  await expect(assertInviteQuota(USERS.bob.id, 1)).rejects.toThrow();
});

test("a null invite limit is unlimited", async () => {
  await expect(assertInviteQuota(USERS.bob.id, 1000)).resolves.toBeUndefined();
});

test("admins are exempt from the invite quota", async () => {
  await updateAppSettings({ max_invites_per_user: 0, max_columns_per_user: null });
  await expect(assertInviteQuota(USERS.alice.id, 5)).resolves.toBeUndefined();
});

test("a per-user override wins over the global invite limit", async () => {
  await updateAppSettings({ max_invites_per_user: 100, max_columns_per_user: null });
  await setUserLimits(USERS.bob.id, { invite_limit: 0, column_limit: null });
  await expect(assertInviteQuota(USERS.bob.id, 1)).rejects.toThrow();
});

test("assertColumnQuota throws at the limit and passes below it", async () => {
  const bob = (await listUsers()).find((u) => u.user_id === USERS.bob.id)!;
  const used = bob.columns_used;

  await updateAppSettings({ max_invites_per_user: null, max_columns_per_user: used });
  await expect(assertColumnQuota(USERS.bob.id)).rejects.toThrow();

  await updateAppSettings({ max_invites_per_user: null, max_columns_per_user: used + 1 });
  await expect(assertColumnQuota(USERS.bob.id)).resolves.toBeUndefined();
});

test("admins are exempt from the column quota", async () => {
  await updateAppSettings({ max_invites_per_user: null, max_columns_per_user: 0 });
  await expect(assertColumnQuota(USERS.alice.id)).resolves.toBeUndefined();
});

test("setUserBanned toggles a non-admin and refuses admins", async () => {
  await setUserBanned(USERS.bob.id, true);
  const banned = (await listUsers()).find((u) => u.user_id === USERS.bob.id)!;
  expect(banned.banned).toBe(true);

  await expect(setUserBanned(USERS.alice.id, true)).rejects.toThrow();
});

test("setUserAdmin refuses to demote the last admin", async () => {
  // Alice is the only seeded admin.
  await expect(setUserAdmin(USERS.alice.id, false)).rejects.toThrow();
});

test("getInviteQuota reflects the effective limit; admins are unlimited", async () => {
  await updateAppSettings({ max_invites_per_user: 4, max_columns_per_user: null });
  const bob = await getInviteQuota(USERS.bob.id);
  expect(bob.limit).toBe(4);
  expect(bob.used).toBeGreaterThanOrEqual(0);

  // Admins report a null (unlimited) limit regardless of the global cap.
  expect((await getInviteQuota(USERS.alice.id)).limit).toBe(null);
});

test("getColumnQuota reflects the effective limit and current usage", async () => {
  await updateAppSettings({ max_invites_per_user: null, max_columns_per_user: 50 });
  const bob = await getColumnQuota(USERS.bob.id);
  expect(bob.limit).toBe(50);
  const listed = (await listUsers()).find((u) => u.user_id === USERS.bob.id)!;
  expect(bob.used).toBe(listed.columns_used);

  expect((await getColumnQuota(USERS.alice.id)).limit).toBe(null);
});

test("listUsers reports admin flag and usage", async () => {
  const users = await listUsers();
  const alice = users.find((u) => u.user_id === USERS.alice.id)!;
  expect(alice.is_admin).toBe(true);
  expect(alice.handle).toBe("alice");
  expect(alice.invites_used).toBeGreaterThanOrEqual(0);
});
