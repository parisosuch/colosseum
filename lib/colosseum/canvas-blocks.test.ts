import { beforeAll, expect, test } from "bun:test";

import { db } from "@/lib/db";
import { channelCanvas } from "@/lib/db/schema";
import { seed, USERS } from "@/scripts/seed";
import {
  channelHasCanvas,
  countUnplacedColumns,
  getChannelColumnsByIds,
  getUnplacedColumns,
} from "./canvas-blocks";
import { createChannel } from "./channel";
import { uploadTextColumn, type Column } from "./column";

beforeAll(async () => {
  await seed();
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

test("channelHasCanvas is false until the canvas row exists", async () => {
  const { ch } = await channelWith(0);
  expect(await channelHasCanvas(ch.id)).toBe(false);
  await db.insert(channelCanvas).values({ channel_id: ch.id, doc: new Uint8Array([0, 0]) });
  expect(await channelHasCanvas(ch.id)).toBe(true);
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
