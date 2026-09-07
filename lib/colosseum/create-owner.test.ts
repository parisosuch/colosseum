import { beforeAll, expect, test } from "bun:test";

import { GROUPS, seed, USERS } from "@/scripts/seed";
import { getViewerChannels, viewerScope } from "./channel";
import { setGroupRole } from "./group";
import { resolveCreateOwner } from "./owner";

beforeAll(async () => {
  await seed();
});

// resolveCreateOwner is the whole authorization story for "create a channel
// under this handle", shared by the REST route and the MCP tool.
test("no handle means your own owner row", async () => {
  expect(await resolveCreateOwner(USERS.alice.id, undefined)).toBe(USERS.alice.ownerId);
  // Naming yourself is the same answer, not a refusal.
  expect(await resolveCreateOwner(USERS.alice.id, USERS.alice.handle)).toBe(USERS.alice.ownerId);
});

test("a group you manage resolves to the group", async () => {
  expect(await resolveCreateOwner(USERS.alice.id, GROUPS.studio.handle)).toBe(GROUPS.studio.id);
});

// The distinction that makes the middle role mean something at the API too.
test("a group you're only a member of is refused", async () => {
  expect(resolveCreateOwner(USERS.bob.id, GROUPS.studio.handle)).rejects.toThrow(
    /do not have permission/,
  );
  await setGroupRole(GROUPS.studio.id, USERS.bob.id, "admin");
  try {
    expect(await resolveCreateOwner(USERS.bob.id, GROUPS.studio.handle)).toBe(GROUPS.studio.id);
  } finally {
    await setGroupRole(GROUPS.studio.id, USERS.bob.id, "member");
  }
});

test("another person's handle is refused, and an unknown one says so", async () => {
  expect(resolveCreateOwner(USERS.bob.id, USERS.alice.handle)).rejects.toThrow(
    /only create channels for yourself or a group/,
  );
  expect(resolveCreateOwner(USERS.bob.id, "nobody-here")).rejects.toThrow(
    /No owner with the handle/,
  );
});

// Handles are normalized on the way in, the same as everywhere else they are
// accepted, so a client that upper-cases one is not told it doesn't exist.
test("the handle is normalized before it is looked up", async () => {
  expect(await resolveCreateOwner(USERS.alice.id, GROUPS.studio.handle.toUpperCase())).toBe(
    GROUPS.studio.id,
  );
});

test("getViewerChannels spans your own owner and your groups, with each handle", async () => {
  const mine = await getViewerChannels(await viewerScope(USERS.bob.id));
  const byHandle = new Map(mine.map((c) => [c.title, c.handle]));
  // Bob's own channel comes back under his handle...
  expect(byHandle.get("Photography")).toBe(USERS.bob.handle);
  // ...and the group's under the group's, which is what its link needs.
  expect(byHandle.get("Studio Shelf")).toBe(GROUPS.studio.handle);
  // Including the private one, since he is in the group.
  expect(byHandle.get("Studio Backroom")).toBe(GROUPS.studio.handle);
  // Never someone else's.
  expect(mine.some((c) => c.title === "Design Inspiration")).toBe(false);
});

test("a signed-out scope has no channels rather than every channel", async () => {
  expect(await getViewerChannels(await viewerScope(null))).toEqual([]);
});
