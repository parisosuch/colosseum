import { beforeAll, expect, test } from "bun:test";

import { INVITE_CODES, seed, USERS } from "@/scripts/seed";
import { claimInviteCode, getMyInviteCodes } from "./invite";

beforeAll(async () => {
  await seed();
});

test("getMyInviteCodes returns the caller's codes with usage counts", async () => {
  const byCode = new Map((await getMyInviteCodes(USERS.alice.id)).map((c) => [c.code, c]));
  expect(byCode.get(INVITE_CODES.unused)?.uses).toBe(0);
  expect(byCode.get(INVITE_CODES.used)?.uses).toBe(1);
});

test("getMyInviteCodes is scoped to the caller", async () => {
  // Bob created no codes.
  expect(await getMyInviteCodes(USERS.bob.id)).toEqual([]);
});

test("claimInviteCode fails on a spent single-use code", async () => {
  expect(await claimInviteCode(INVITE_CODES.used)).toBe(false);
});

test("claimInviteCode fails on an unknown code", async () => {
  expect(await claimInviteCode("NOSUCHCODE")).toBe(false);
});
