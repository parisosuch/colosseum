import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { createGroup } from "./group";
import { isHandleAvailable, updateProfile } from "./profile";
import { getUserProfile } from "./user";

beforeAll(async () => {
  await seed();
});

test("isHandleAvailable reports a free handle, a taken one, and an invalid one", async () => {
  expect(await isHandleAvailable("nobody-holds-this")).toBe(true);
  expect(await isHandleAvailable(USERS.alice.handle)).toBe(false);
  // Too short to be a handle at all — a different answer from "taken".
  expect(await isHandleAvailable("ab")).toBeNull();
});

test("isHandleAvailable counts a group's handle as taken", async () => {
  // People and groups share one `owner.handle` namespace. Checking only user
  // profiles reported a group's handle free, and the save then failed with
  // HandleTakenError — the form said yes and the write said no.
  // A fresh handle each run: seed() doesn't clear groups, so a fixed one is
  // already claimed the second time this suite runs against the same database.
  const handle = `ns-probe-${Date.now().toString(36)}`;
  await createGroup({ handle, name: "Probe", created_by: USERS.bob.id });
  expect(await isHandleAvailable(handle)).toBe(false);
});

test("updateProfile edits the bio without disturbing the handle", async () => {
  const before = (await getUserProfile(USERS.alice.id))!;
  const after = await updateProfile(USERS.alice.id, before, { about: "collects type specimens" });
  expect(after.about).toBe("collects type specimens");
  expect(after.handle).toBe(before.handle);
});
