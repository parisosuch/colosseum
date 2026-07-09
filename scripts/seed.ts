// Deterministic dev + test fixtures. Run it directly to populate a local DB:
//   bun --conditions=react-server scripts/seed.ts   (or: make seed)
// and import { seed, USERS, ... } from it to set up the test suite.
//
// It is idempotent: every run first removes the rows it owns (by the fixed
// seed user ids and invite codes) and re-inserts them, so re-running — or
// chaining after `make db-reset` — always lands on the same known state.

import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  channel,
  column,
  comment,
  inviteCode,
  inviteRedemption,
  user,
  userProfile,
} from "@/lib/db/schema";

type SeedUser = { id: string; name: string; email: string; handle: string; about: string };

export const USERS: Record<"alice" | "bob", SeedUser> = {
  alice: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Alice Seed",
    email: "alice@example.test",
    handle: "alice",
    about: "Collector of nice things.",
  },
  bob: {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Bob Seed",
    email: "bob@example.test",
    handle: "bob",
    about: "Takes photos.",
  },
};

export const CHANNELS = {
  aliceDesign: { title: "Design Inspiration", tags: ["design", "ui"] },
  alicePrivate: { title: "Private Notes", tags: [] as string[] },
  bobPhoto: { title: "Photography", tags: ["photo"] },
};

// Distinctive block titles so a search term matches exactly one seed block.
export const BLOCKS = {
  alicePublic: "Quokka sketch",
  alicePrivate: "Quokka secret",
};

// Comments on the alicePublic block: one by the block owner, one by another
// user, so tests can assert delete authorization from both angles.
export const COMMENTS = {
  byAlice: "Alice's own note.",
  byBob: "Bob chiming in.",
};

export const INVITE_CODES = {
  unused: "SEEDAAAA",
  used: "SEEDBBBB",
};

export async function seed(): Promise<void> {
  const userIds = Object.values(USERS).map((u) => u.id);
  const codes = Object.values(INVITE_CODES);

  // Clear prior seed rows. Deleting the users cascades to their profiles,
  // channels (→ columns), and redemptions; invite codes are set-null on user
  // delete, so drop them explicitly by code first (that cascades redemptions).
  await db.delete(inviteCode).where(inArray(inviteCode.code, codes));
  await db.delete(user).where(inArray(user.id, userIds));

  await db.insert(user).values(
    Object.values(USERS).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: true,
    })),
  );
  await db
    .insert(userProfile)
    .values(Object.values(USERS).map((u) => ({ user_id: u.id, handle: u.handle, about: u.about })));

  // One unused single-use code, and one already redeemed by bob.
  await db.insert(inviteCode).values([
    {
      code: INVITE_CODES.unused,
      created_by: USERS.alice.id,
      max_uses: 1,
      uses: 0,
      note: "Unused seed invite",
    },
    {
      code: INVITE_CODES.used,
      created_by: USERS.alice.id,
      max_uses: 1,
      uses: 1,
      note: "Redeemed by bob",
    },
  ]);
  await db.insert(inviteRedemption).values({ code: INVITE_CODES.used, user_id: USERS.bob.id });

  const [aliceDesign] = await db
    .insert(channel)
    .values({
      title: CHANNELS.aliceDesign.title,
      owner_id: USERS.alice.id,
      private: false,
      tags: CHANNELS.aliceDesign.tags,
    })
    .returning();
  const [alicePrivate] = await db
    .insert(channel)
    .values({
      title: CHANNELS.alicePrivate.title,
      owner_id: USERS.alice.id,
      private: true,
      tags: CHANNELS.alicePrivate.tags,
    })
    .returning();
  await db.insert(channel).values({
    title: CHANNELS.bobPhoto.title,
    owner_id: USERS.bob.id,
    private: false,
    tags: CHANNELS.bobPhoto.tags,
  });

  // Blocks in Alice's public channel, plus one in her private channel so tests
  // can assert cross-user search never surfaces private blocks. The titles use
  // distinctive tokens (BLOCKS) so a search matches exactly one.
  const [alicePublicBlock] = await db
    .insert(column)
    .values([
      {
        type: "text",
        title: BLOCKS.alicePublic,
        text: "Something worth keeping.",
        created_by: USERS.alice.id,
        channel_id: aliceDesign.id,
        tags: [],
      },
      {
        type: "url",
        title: "A link",
        url: "https://example.com",
        created_by: USERS.alice.id,
        channel_id: aliceDesign.id,
        tags: ["ref"],
      },
      {
        type: "text",
        title: BLOCKS.alicePrivate,
        text: "For my eyes only.",
        created_by: USERS.alice.id,
        channel_id: alicePrivate.id,
        tags: [],
      },
    ])
    .returning();

  // Comments on Alice's public block, one from each user.
  await db.insert(comment).values([
    { column_id: alicePublicBlock.id, author_id: USERS.alice.id, body: COMMENTS.byAlice },
    { column_id: alicePublicBlock.id, author_id: USERS.bob.id, body: COMMENTS.byBob },
  ]);
}

if (import.meta.main) {
  await seed();
  console.log("Seeded fixtures for", Object.keys(USERS).join(", "));
  process.exit(0);
}
