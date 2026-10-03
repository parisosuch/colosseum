import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { db } from "@/lib/db";
import { channelCanvas } from "@/lib/db/schema";
import { elementsOf } from "@/lib/realtime/canvas-doc";
import {
  connectAs,
  destroyClients,
  startHarness,
  synced,
  type Harness,
} from "@/lib/realtime/canvas-test-harness";
import { seed, USERS } from "@/scripts/seed";
import {
  countUnplacedColumns,
  getChannelColumnsByIds,
  getUnplacedColumns,
  showsCanvasButton,
} from "./canvas-blocks";
import { canContributeChannel, createChannel, getChannel, resolveChannelViewer } from "./channel";
import { uploadTextColumn, type Column } from "./column";

let harness: Harness;

beforeAll(async () => {
  await seed();
  harness = await startHarness();
});

afterEach(() => destroyClients());

afterAll(async () => {
  await harness.close();
});

let seq = 0;
async function channelWith(n: number) {
  const ch = await createChannel({
    title: `Canvas blocks ${++seq}`,
    access: "public",
    owned_by: USERS.alice.ownerId,
  });
  const cols: Column[] = [];
  for (let i = 0; i < n; i++) {
    cols.push(
      await uploadTextColumn({
        created_by: USERS.alice.id,
        channel_id: ch.id,
        text: i % 2 === 0 ? `even note ${i}` : `odd note ${i}`,
      }),
    );
  }
  return { ch, cols };
}

// The channel page's rule, for a real viewer of the channel.
async function buttonFor(channelId: number, userId: string): Promise<boolean> {
  const channel = (await getChannel(channelId))!;
  const viewer = await resolveChannelViewer(channel, userId);
  return showsCanvasButton(channelId, canContributeChannel(channel, viewer));
}

async function storedFlag(channelId: number): Promise<boolean | null> {
  const [row] = await db
    .select({ hasElements: channelCanvas.has_elements })
    .from(channelCanvas)
    .where(eq(channelCanvas.channel_id, channelId));
  return row ? row.hasElements : null;
}

// Poll until the realtime server's save has stored `want`.
async function flagBecomes(channelId: number, want: boolean): Promise<boolean | null> {
  let flag: boolean | null = null;
  for (let i = 0; i < 150 && (flag = await storedFlag(channelId)) !== want; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return flag;
}

test("an empty canvas hides the button from non-editors, emptied after editing included", async () => {
  // Public: alice (the owner) edits, bob can only read.
  const { ch, cols } = await channelWith(1);
  expect(await buttonFor(ch.id, USERS.bob.id)).toBe(false);
  expect(await buttonFor(ch.id, USERS.alice.id)).toBe(true);

  const alice = connectAs(harness, ch.id, USERS.alice.id);
  await synced(alice.provider);
  const el = new Y.Map<unknown>();
  el.set("type", "block");
  el.set("columnId", cols[0].id);
  el.set("x", 0);
  el.set("y", 0);
  elementsOf(alice.doc).set("placed", el);
  expect(await flagBecomes(ch.id, true)).toBe(true);
  expect(await buttonFor(ch.id, USERS.bob.id)).toBe(true);

  // Emptied: the row stays (its delete set with it) and the flag goes false.
  elementsOf(alice.doc).delete("placed");
  expect(await flagBecomes(ch.id, false)).toBe(false);
  expect(await buttonFor(ch.id, USERS.bob.id)).toBe(false);
  expect(await buttonFor(ch.id, USERS.alice.id)).toBe(true);
});

test("by-id reads are scoped to the channel", async () => {
  const a = await channelWith(2);
  const b = await channelWith(1);
  const got = await getChannelColumnsByIds(a.ch.id, [...a.cols.map((c) => c.id), b.cols[0].id, -1]);
  expect(got.map((c) => c.id).sort()).toEqual(a.cols.map((c) => c.id).sort());
  expect(got.every((c) => c.html)).toBe(true);
  expect(await getChannelColumnsByIds(a.ch.id, [])).toEqual([]);
});

test("unplaced pages walk newest first by cursor and skip placed blocks", async () => {
  const { ch, cols } = await channelWith(7);
  const newestFirst = [...cols].reverse().map((c) => c.id);
  const placed = [newestFirst[1], newestFirst[4]];
  const expected = newestFirst.filter((id) => !placed.includes(id));

  const first = await getUnplacedColumns(ch.id, { placed, limit: 3 });
  expect(first.map((c) => c.id)).toEqual(expected.slice(0, 3));

  // Placing a block that's already been paged past doesn't shift the next
  // page, which offset paging would.
  const placedLater = [...placed, expected[0]];
  const second = await getUnplacedColumns(ch.id, {
    placed: placedLater,
    before: first.at(-1)!.id,
    limit: 3,
  });
  expect(second.map((c) => c.id)).toEqual(expected.slice(3, 5));

  expect(await countUnplacedColumns(ch.id, { placed })).toBe(5);
  expect(await countUnplacedColumns(ch.id, { placed: [] })).toBe(7);
});

test("unplaced search uses the channel search and counts what matches", async () => {
  const { ch, cols } = await channelWith(6);
  const odd = cols.filter((c) => c.text?.startsWith("odd"));
  const got = await getUnplacedColumns(ch.id, { placed: [odd[0].id], search: "odd" });
  expect(got.map((c) => c.id).sort()).toEqual(
    odd
      .slice(1)
      .map((c) => c.id)
      .sort(),
  );
  expect(await countUnplacedColumns(ch.id, { placed: [odd[0].id], search: "odd" })).toBe(2);
});

test("the page size is capped", async () => {
  const { ch } = await channelWith(3);
  expect((await getUnplacedColumns(ch.id, { placed: [], limit: 0 })).length).toBe(1);
  expect((await getUnplacedColumns(ch.id, { placed: [], limit: 10_000 })).length).toBe(3);
});
