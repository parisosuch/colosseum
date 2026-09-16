import { beforeAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { column } from "@/lib/db/schema";
import { seed, USERS } from "@/scripts/seed";
import {
  ACTIVITY_PAGE,
  blockLabel,
  getActivityFeed,
  getActivityPage,
  groupActivity,
  type ActivityItem,
} from "./activity";
import { createChannel, viewerScope } from "./channel";
import { uploadURLColumn } from "./column";
import { addChannelMemberByHandle } from "./member";

beforeAll(async () => {
  await seed();
});

const b = (over: Partial<Parameters<typeof blockLabel>[0]>) => ({
  type: "text",
  title: null,
  url: null,
  text: null,
  ...over,
});

test("prefers an explicit title", () => {
  expect(blockLabel(b({ type: "url", title: "My Link", url: "https://x.com" }))).toBe("My Link");
});

test("url without title shows the domain/path", () => {
  expect(blockLabel(b({ type: "url", url: "https://example.com/path" }))).toBe("example.com/path");
});

test("text without title is truncated", () => {
  expect(blockLabel(b({ type: "text", text: "x".repeat(80) }))).toBe("x".repeat(60));
});

test("image, video, and channel fall back to a noun", () => {
  expect(blockLabel(b({ type: "image" }))).toBe("an image");
  expect(blockLabel(b({ type: "video" }))).toBe("a video");
  expect(blockLabel(b({ type: "channel" }))).toBe("a channel");
});

test("getActivityFeed: a member's block carries the channel owner's handle", async () => {
  // Bob owns a public channel; Alice is a member and adds the block. The feed
  // attributes it to Alice but the channel still lives under Bob.
  const channel = await createChannel({
    title: "Bob's public channel",
    access: "public",
    owned_by: USERS.bob.ownerId,
  });
  await addChannelMemberByHandle(channel.id, USERS.alice.handle);
  const block = await uploadURLColumn({
    created_by: USERS.alice.id,
    channel_id: channel.id,
    text: "https://ponytail.example/explore-408-member-add",
  });

  const feed = await getActivityFeed(await viewerScope(null), 200);
  const item = feed.find((i) => i.kind === "block" && i.column?.id === block.id);

  expect(item?.handle).toBe(USERS.alice.handle);
  expect(item?.channelHandle).toBe(USERS.bob.handle);
});

test("getActivityFeed: private-channel blocks reach the owner and members, not outsiders", async () => {
  const hasBlock = (items: ActivityItem[], id: number) =>
    items.some((i) => i.kind === "block" && i.column?.id === id);

  // Bob owns a private channel that Alice is a member of.
  const shared = await createChannel({
    title: "Shared",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  await addChannelMemberByHandle(shared.id, USERS.alice.handle);
  const sharedBlock = await uploadURLColumn({
    created_by: USERS.bob.id,
    channel_id: shared.id,
    text: "https://ponytail.example/explore-306-shared",
  });

  // Bob owns another private channel Alice is NOT in.
  const secret = await createChannel({
    title: "Secret",
    access: "private",
    owned_by: USERS.bob.ownerId,
  });
  const secretBlock = await uploadURLColumn({
    created_by: USERS.bob.id,
    channel_id: secret.id,
    text: "https://ponytail.example/explore-306-secret",
  });

  const [bobFeed, aliceFeed, anonFeed] = await Promise.all([
    getActivityFeed(await viewerScope(USERS.bob.id), 200),
    getActivityFeed(await viewerScope(USERS.alice.id), 200),
    getActivityFeed(await viewerScope(null), 200),
  ]);

  // Owner sees both his private blocks.
  expect(hasBlock(bobFeed, sharedBlock.id)).toBe(true);
  expect(hasBlock(bobFeed, secretBlock.id)).toBe(true);
  // Member sees the channel she's in — and not the one she isn't.
  expect(hasBlock(aliceFeed, sharedBlock.id)).toBe(true);
  expect(hasBlock(aliceFeed, secretBlock.id)).toBe(false);
  // Signed-out outsiders never see private blocks.
  expect(hasBlock(anonFeed, sharedBlock.id)).toBe(false);
  expect(hasBlock(anonFeed, secretBlock.id)).toBe(false);
});

const add = (handle: string, channelId: number, id: number, type = "image"): ActivityItem => ({
  kind: "block",
  at: new Date(id * 1000).toISOString(),
  cursor: `${new Date(id * 1000).toISOString()}|0|${id}`,
  handle,
  channelId,
  channelTitle: `c${channelId}`,
  column: { id, type } as ActivityItem["column"],
});

test("groupActivity: consecutive adds by one person to one channel collapse", () => {
  const groups = groupActivity([
    add("alice", 1, 1),
    add("alice", 1, 2),
    add("alice", 1, 3),
    // A different channel, then a different actor, then back to the first pair.
    add("alice", 2, 4),
    add("bob", 2, 5),
    {
      kind: "user",
      at: "2020-01-01T00:00:00.000Z",
      cursor: "2020-01-01T00:00:00.000Z|2|carol",
      handle: "carol",
    },
    add("alice", 1, 6),
  ]);

  expect(groups.map((g) => g.length)).toEqual([3, 1, 1, 1, 1]);
  expect(groups[0].map((i) => i.column!.id)).toEqual([1, 2, 3]);
  expect(groups[4][0].column!.id).toBe(6);
});

test("groupActivity: a channel-column never joins a group", () => {
  const groups = groupActivity([
    add("alice", 1, 1),
    add("alice", 1, 2, "channel"),
    add("alice", 1, 3),
  ]);
  expect(groups.map((g) => g.length)).toEqual([1, 1, 1]);
});

// Blocks stamped at fixed, spaced times in the future, so they sit at the head
// of the feed in a known order however much else the seed and the tests above
// have put in the database. Each batch takes a window above the last, so two
// tests' blocks never interleave.
let stampWindow = Date.now() + 60 * 60 * 1000;
async function stampedBlocks(specs: { by: string; channelId: number }[]) {
  stampWindow += (specs.length + 1) * 1000;
  const base = stampWindow;
  await db.insert(column).values(
    specs.map((s, i) => ({
      type: "url" as const,
      url: `https://ponytail.example/explore-558-${i}`,
      created_by: s.by,
      channel_id: s.channelId,
      // Newest first once the feed sorts, so index 0 leads the page.
      created_at: new Date(base - i * 1000),
    })),
  );
}

test("getActivityFeed: pages through blocks written inside one millisecond", async () => {
  const channel = await createChannel({
    title: "One millisecond",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  // Three blocks sharing a millisecond, then nudged apart by microseconds so
  // they sit at distinct instants Postgres can order but a JS Date cannot hold.
  stampWindow += 4000;
  const rows = await db
    .insert(column)
    .values(
      [0, 1, 2].map((i) => ({
        type: "url" as const,
        url: `https://ponytail.example/explore-560-${i}`,
        created_by: USERS.alice.id,
        channel_id: channel.id,
        created_at: new Date(stampWindow),
      })),
    )
    .returning({ id: column.id });
  // Newest first: index 0 ends up latest within the millisecond.
  const offsets = [456, 200, 0];
  await Promise.all(
    rows.map((r, i) =>
      db.execute(
        sql`update ${column} set created_at = created_at + ${`${offsets[i]} microseconds`}::interval where ${column.id} = ${r.id}`,
      ),
    ),
  );

  const first = await getActivityFeed(await viewerScope(null), 2);
  // The microseconds have to reach `at`. Rounded to the millisecond all three
  // carry the same stamp, which leaves the merge unable to order them and the
  // cursor unable to address them.
  expect(first[1].at).toMatch(/\.\d{6}Z$/);
  expect(first.map((i) => i.column?.id)).toEqual([rows[0].id, rows[1].id]);

  // The next row down shares a millisecond with the cursor. Against a cursor
  // rounded down it was older than the last item shown and not older than the
  // cursor, so it appeared on no page at all.
  const second = await getActivityFeed(await viewerScope(null), 2, first[1].at);
  expect(second.map((i) => i.column?.id)).toContain(rows[2].id);
});

test("getActivityPage: a run longer than one page stays a single group", async () => {
  const channel = await createChannel({
    title: "A burst",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  // Comfortably over ACTIVITY_PAGE, which is where the run used to be cut.
  const run = ACTIVITY_PAGE + 6;
  await stampedBlocks(
    Array.from({ length: run }, () => ({ by: USERS.alice.id, channelId: channel.id })),
  );

  const page = await getActivityPage(await viewerScope(null));
  const groups = groupActivity(page.items);

  expect(groups[0].length).toBe(run);
  // The cursor has to clear the whole run, or the next page re-opens it. It is
  // the last item's full position now, not just its timestamp.
  expect(page.nextCursor).toBe(page.items[run - 1].cursor);
  expect(page.hasMore).toBe(true);
});

test("getActivityPage: another actor ends the run past the page boundary", async () => {
  const channel = await createChannel({
    title: "A burst, interrupted",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  // Alice's run crosses the page boundary and then Bob adds one, which ends it.
  const before = ACTIVITY_PAGE + 3;
  await stampedBlocks([
    ...Array.from({ length: before }, () => ({ by: USERS.alice.id, channelId: channel.id })),
    { by: USERS.bob.id, channelId: channel.id },
    { by: USERS.alice.id, channelId: channel.id },
  ]);

  const first = await getActivityPage(await viewerScope(null));
  // The page stops where the run does, rather than reading on into Bob's add.
  expect(groupActivity(first.items)[0].length).toBe(before);
  expect(first.items.length).toBe(before);
  expect(first.hasMore).toBe(true);

  // And the next page opens on Bob, so nothing is skipped and the run isn't
  // re-opened below it.
  const second = await getActivityPage(await viewerScope(null), first.nextCursor!);
  expect(second.items[0].handle).toBe(USERS.bob.handle);
  expect(second.items[1].handle).toBe(USERS.alice.handle);
});

test("getActivityFeed pages through blocks that share an instant exactly", async () => {
  const channel = await createChannel({
    title: "Same instant",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  // One statement, one `created_at` for all three — the timestamp alone cannot
  // separate them, so `< at` drops all three and `<= at` repeats them.
  stampWindow += 6000;
  const rows = await db
    .insert(column)
    .values(
      [0, 1, 2].map((i) => ({
        type: "url" as const,
        url: `https://ponytail.example/explore-567-${i}`,
        created_by: USERS.alice.id,
        channel_id: channel.id,
        created_at: new Date(stampWindow),
      })),
    )
    .returning({ id: column.id });
  const ids = rows.map((r) => r.id).sort((a, b) => b - a);

  // Page one at a time; each cursor has to land on the next id down.
  const first = await getActivityFeed(await viewerScope(null), 1);
  expect(first[0].column?.id).toBe(ids[0]);

  const second = await getActivityFeed(await viewerScope(null), 1, first[0].cursor);
  expect(second[0].column?.id).toBe(ids[1]);

  const third = await getActivityFeed(await viewerScope(null), 1, second[0].cursor);
  expect(third[0].column?.id).toBe(ids[2]);
});

test("a cursor from an older page still pages, as a bare timestamp", async () => {
  const channel = await createChannel({
    title: "Legacy cursor",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  stampWindow += 6000;
  await db.insert(column).values(
    [0, 1].map((i) => ({
      type: "url" as const,
      url: `https://ponytail.example/explore-567-legacy-${i}`,
      created_by: USERS.alice.id,
      channel_id: channel.id,
      created_at: new Date(stampWindow - i * 1000),
    })),
  );

  const page = await getActivityFeed(await viewerScope(null), 1);
  // What a page loaded before this change would hand back: the timestamp on its
  // own. It must keep working rather than erroring or repeating the item.
  const legacy = page[0].at;
  const next = await getActivityFeed(await viewerScope(null), 1, legacy);
  expect(next[0].column?.id).not.toBe(page[0].column?.id);
  expect(next[0].at < legacy).toBe(true);
});
