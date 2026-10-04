import { beforeAll, expect, test } from "bun:test";

import { DEFAULT_CHANNEL_QUERY } from "@/lib/canvas/channel-query";
import { seed, USERS } from "@/scripts/seed";
import { createChannel } from "./channel";
import { uploadTextColumn } from "./column";
import { createShareLink, resolveShareToken, type ResolvedShare } from "./share-link";
import { shareBoardFirstPage } from "./share-page";

let share: ResolvedShare;
const ids: number[] = [];

beforeAll(async () => {
  await seed();
  const ch = await createChannel({
    title: "Shared board query",
    access: "private",
    owned_by: USERS.alice.ownerId,
  });
  for (const text of ["pear first", "fig second", "pear third"]) {
    const col = await uploadTextColumn({ created_by: USERS.alice.id, channel_id: ch.id, text });
    ids.push(col.id);
  }
  const { token } = await createShareLink({ channelId: ch.id, expiresAt: null, createdBy: null });
  share = (await resolveShareToken(token))!;
});

// The board writes its controls to the URL, so a share link's first paint has
// to read them back, or a reload shows a different board than the URL says.
test("a shared board's first page follows the URL's sort and filters", async () => {
  const board = await shareBoardFirstPage(share, { sort: "oldest", q: "pear", view: "list" });
  expect(board.query).toEqual({ sort: "oldest", type: "all", q: "pear", view: "list" });
  expect(board.initialColumns.map((c) => c.id)).toEqual([ids[0], ids[2]]);
  expect(board.totalCount).toBe(3);
  expect(board.filteredCount).toBe(2);
});

test("a bare share link gets the channel page's defaults, and junk params fall back", async () => {
  const bare = await shareBoardFirstPage(share, {});
  expect(bare.query).toEqual(DEFAULT_CHANNEL_QUERY);
  expect(bare.filteredCount).toBeNull();
  expect(bare.initialColumns).toHaveLength(3);

  const junk = await shareBoardFirstPage(share, { sort: "sideways", type: ["url", "text"] });
  expect(junk.query).toEqual({ ...DEFAULT_CHANNEL_QUERY, type: "url" });
  expect(junk.initialColumns).toEqual([]);
  expect(junk.filteredCount).toBe(0);
});
