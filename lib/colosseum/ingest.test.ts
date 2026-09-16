import { beforeAll, expect, test } from "bun:test";

import { seed, USERS } from "@/scripts/seed";
import { createChannel } from "./channel";
import { getChannelColumns } from "./column";
import { ingestUrlColumn } from "./ingest";

beforeAll(async () => {
  await seed();
});

// The per-type branches (tweet, YouTube, Spotify, GitHub, Instagram, direct
// image) each fetch from the host they name, so they aren't exercised here —
// a test for them would be a live call to x.com. What is covered is the path
// that needs no network: a link that matches nothing in particular stays a
// plain url block, which is also the fallback every other branch lands on when
// its lookup fails.
test("ingestUrlColumn stores an ordinary link as a plain url block", async () => {
  const channel = await createChannel({
    title: "Ingest",
    access: "public",
    owned_by: USERS.alice.ownerId,
  });

  const url = "https://ponytail.example/nothing-special";
  const block = await ingestUrlColumn({
    url,
    userId: USERS.alice.id,
    channelId: channel.id,
    channelPrivate: false,
  });

  expect(block.type).toBe("url");
  expect(block.url).toBe(url);
  expect(block.channel_id).toBe(channel.id);
  expect((await getChannelColumns(channel.id)).map((c) => c.id)).toEqual([block.id]);
});
