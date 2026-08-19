import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { loadVisibleBlock } from "./block-access";
import { createChannel } from "./channel";
import { uploadTextColumn } from "./column";

beforeAll(async () => {
  await seed();
});

test("loadVisibleBlock resolves a block in a public channel", async () => {
  const ch = await createChannel({
    title: "Open Book",
    access: "public",
    owner_id: USERS.alice.id,
  });
  const block = await uploadTextColumn({
    created_by: USERS.alice.id,
    channel_id: ch.id,
    text: "hello",
  });

  const found = await loadVisibleBlock(ch.id, block.id);
  expect(found?.column.id).toBe(block.id);
  expect(found?.channel.id).toBe(ch.id);
});

test("loadVisibleBlock rejects a block that belongs to a different channel", async () => {
  // The deep link puts both ids in the URL, so a block id can be paired with a
  // channel the viewer *can* read. The pairing has to be checked, not assumed.
  const mine = await createChannel({ title: "Mine", access: "public", owner_id: USERS.alice.id });
  const other = await createChannel({ title: "Other", access: "public", owner_id: USERS.bob.id });
  const block = await uploadTextColumn({
    created_by: USERS.bob.id,
    channel_id: other.id,
    text: "not yours",
  });

  expect(await loadVisibleBlock(mine.id, block.id)).toBeNull();
});

test("loadVisibleBlock returns null for missing blocks and unparsed ids", async () => {
  const ch = await createChannel({ title: "Sparse", access: "public", owner_id: USERS.alice.id });
  expect(await loadVisibleBlock(ch.id, 99999999)).toBeNull();
  // `?block=abc` parses to NaN; it must not fall through to a query.
  expect(await loadVisibleBlock(ch.id, NaN)).toBeNull();
  expect(await loadVisibleBlock(NaN, 1)).toBeNull();
});
