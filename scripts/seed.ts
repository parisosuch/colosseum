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
  channelMember,
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
  // Open (collaborative): anyone signed in may add blocks.
  aliceOpen: { title: "Open Collab", tags: ["open"] },
  bobPhoto: { title: "Photography", tags: ["photo"] },
  // Private group owned by bob; alice is an invited member (see channelMember
  // insert below), so she can read + contribute but strangers cannot.
  bobGroup: { title: "Bob Group", tags: [] as string[] },
};

// Distinctive block titles so a search term matches exactly one seed block.
export const BLOCKS = {
  alicePublic: "Quokka sketch",
  alicePrivate: "Quokka secret",
  bobGroup: "Quokka groupthing",
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

// ---------------------------------------------------------------------------
// Bulk filler data — a large, self-contained population of extra users,
// channels, members, blocks, and comments so the dev app doesn't look empty.
// It is deliberately kept apart from the alice/bob fixtures above (which the
// test suite asserts on): the bulk users own everything here, their ids live in
// a separate `2000…` range, and the vocabulary below avoids every token the
// tests search for ("design", "photography", "private", "Quokka…") so a bulk
// row can never crowd a fixture out of a capped/ordered query. Bulk rows are
// timestamped in the past so recency-ordered feeds still surface fixtures first.
// None of this is exported — tests never depend on it.
// ---------------------------------------------------------------------------
const BULK_USER_COUNT = 60;

// Deterministic bulk users (no RNG in their identity, so cleanup can delete a
// prior run's rows by the same ids). Ids sit in the 2000… range, clear of the
// 1000… fixtures.
function bulkUsers(): SeedUser[] {
  return Array.from({ length: BULK_USER_COUNT }, (_, i) => {
    const nn = String(i + 1).padStart(2, "0");
    return {
      id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      name: `Seed Member ${nn}`,
      email: `member${nn}@example.test`,
      handle: `member${nn}`,
      about: "",
    };
  });
}

// Word banks, all free of the tokens the tests search for.
const ADJ =
  "Cobalt Amber Verdant Slate Ivory Umber Sable Cerulean Marigold Onyx Russet Teal Saffron Indigo Maroon Pewter Coral Jade Sienna Ochre".split(
    " ",
  );
const NOUN =
  "Archive Studio Gallery Ledger Atlas Almanac Compendium Registry Anthology Portfolio Cabinet Vault Index Journal Catalog Dossier Folio Miscellany Scrapbook Assembly".split(
    " ",
  );
const TAGS =
  "mood texture form palette grid motion matter signal layer tone surface rhythm scale weight contrast".split(
    " ",
  );
const SENTENCES = [
  "A quiet study in light and shade.",
  "Fragments worth returning to.",
  "Textures pulled from everywhere.",
  "Something about the shape of it.",
  "Kept for later, for no reason.",
  "Colors that sit well together.",
  "An idea only half-formed.",
  "Loose threads and loose ends.",
];
const URLS = [
  "https://example.com",
  "https://example.org",
  "https://example.net",
  "https://placeholder.test",
  "https://sample.example",
  "https://demo.example",
];
const ABOUTS = [
  "Curating quietly.",
  "Building things.",
  "Here for the archive.",
  "Assembling ideas.",
  "Making and collecting.",
  "Long-time lurker.",
];
const COMMENT_BODIES = [
  "Love this.",
  "Great find.",
  "Adding to my list.",
  "Where's this from?",
  "So good.",
  "Reminds me of something.",
  "Bookmarking this.",
  "Nice one.",
];

export async function seed(): Promise<void> {
  const bulk = bulkUsers();
  const userIds = [...Object.values(USERS).map((u) => u.id), ...bulk.map((u) => u.id)];

  // A small deterministic RNG (reset every call) so bulk data is varied but
  // reproducible within a run and never touches Math.random.
  let rngState = 0x9e3779b9 >>> 0;
  const rand = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 0x100000000;
  };
  const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)];
  const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const chance = (p: number) => rand() < p;
  const sampleN = <T>(a: T[], n: number): T[] => {
    const pool = [...a];
    const out: T[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    }
    return out;
  };
  const EPOCH = new Date("2025-01-01T00:00:00Z").getTime();
  const pastDate = () => new Date(EPOCH + randInt(0, 330) * 86_400_000 + randInt(0, 86_399) * 1000);

  // Clear prior seed rows. Deleting the users cascades to their profiles,
  // channels (→ columns, members, comments), and redemptions; invite codes are
  // set-null on user delete, so drop them explicitly first (by creator, which
  // covers both the fixture codes and the generated invite tree — that delete
  // cascades their redemptions).
  await db.delete(inviteCode).where(inArray(inviteCode.created_by, userIds));
  await db.delete(user).where(inArray(user.id, userIds));

  await db.insert(user).values(
    [...Object.values(USERS), ...bulk].map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: true,
    })),
  );
  await db
    .insert(userProfile)
    .values(Object.values(USERS).map((u) => ({ user_id: u.id, handle: u.handle, about: u.about })));
  await db
    .insert(userProfile)
    .values(bulk.map((u) => ({ user_id: u.id, handle: u.handle, about: pick(ABOUTS) })));

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

  // A single invite tree so the /users network graph matches how the app
  // actually works: alice is the root (the first account, invited by nobody),
  // bob descends from her (fixture code above), and every bulk member redeems a
  // code minted by someone who onboarded strictly earlier — so all 62 members
  // form one connected tree rooted at alice, with no orphan clusters. One
  // redemption per invitee respects the unique(user_id) constraint.
  const invitePool = [USERS.alice, USERS.bob, ...bulk];
  const treeCodes: (typeof inviteCode.$inferInsert)[] = [];
  const treeRedemptions: (typeof inviteRedemption.$inferInsert)[] = [];
  bulk.forEach((member, i) => {
    // invitePool[i + 2] is `member`; pick any strictly earlier participant,
    // already connected to the root, so the tree stays one component.
    const inviter = invitePool[randInt(0, i + 1)];
    const code = `TREESEED${String(i + 1).padStart(4, "0")}`;
    treeCodes.push({
      code,
      created_by: inviter.id,
      max_uses: 1,
      uses: 1,
      note: "Seed invite tree",
    });
    treeRedemptions.push({ code, user_id: member.id });
  });
  await db.insert(inviteCode).values(treeCodes);
  await db.insert(inviteRedemption).values(treeRedemptions);

  const [aliceDesign] = await db
    .insert(channel)
    .values({
      title: CHANNELS.aliceDesign.title,
      owner_id: USERS.alice.id,
      access: "public",
      tags: CHANNELS.aliceDesign.tags,
    })
    .returning();
  const [alicePrivate] = await db
    .insert(channel)
    .values({
      title: CHANNELS.alicePrivate.title,
      owner_id: USERS.alice.id,
      access: "private",
      tags: CHANNELS.alicePrivate.tags,
    })
    .returning();
  const [aliceOpen] = await db
    .insert(channel)
    .values({
      title: CHANNELS.aliceOpen.title,
      owner_id: USERS.alice.id,
      access: "open",
      tags: CHANNELS.aliceOpen.tags,
    })
    .returning();
  await db.insert(channel).values({
    title: CHANNELS.bobPhoto.title,
    owner_id: USERS.bob.id,
    access: "public",
    tags: CHANNELS.bobPhoto.tags,
  });
  const [bobGroup] = await db
    .insert(channel)
    .values({
      title: CHANNELS.bobGroup.title,
      owner_id: USERS.bob.id,
      access: "private",
      tags: CHANNELS.bobGroup.tags,
    })
    .returning();
  // Alice is an invited member of bob's private group.
  await db.insert(channelMember).values({ channel_id: bobGroup.id, user_id: USERS.alice.id });

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
      {
        type: "text",
        title: "Open board block",
        text: "Anyone can add here.",
        created_by: USERS.alice.id,
        channel_id: aliceOpen.id,
        tags: [],
      },
      {
        type: "text",
        title: BLOCKS.bobGroup,
        text: "Members only, but searchable to them.",
        created_by: USERS.bob.id,
        channel_id: bobGroup.id,
        tags: [],
      },
    ])
    .returning();

  // Comments on Alice's public block, one from each user.
  await db.insert(comment).values([
    { column_id: alicePublicBlock.id, author_id: USERS.alice.id, body: COMMENTS.byAlice },
    { column_id: alicePublicBlock.id, author_id: USERS.bob.id, body: COMMENTS.byBob },
  ]);

  // -------------------------------------------------------------------------
  // Bulk world: many channels across all access modes, each with members,
  // blocks, and comments, all owned by the bulk users (never alice/bob).
  // -------------------------------------------------------------------------
  const ACCESS = ["public", "public", "public", "open", "private", "private"] as const;
  type Spec = { ownerId: string; access: (typeof ACCESS)[number]; memberIds: string[] };

  const channelValues: (typeof channel.$inferInsert)[] = [];
  const specs: Spec[] = [];
  for (const u of bulk) {
    for (let c = 0; c < randInt(1, 6); c++) {
      const access = pick([...ACCESS]);
      channelValues.push({
        title: `${pick(ADJ)} ${pick(NOUN)}`,
        description: chance(0.6) ? pick(SENTENCES) : null,
        owner_id: u.id,
        access,
        tags: sampleN(TAGS, randInt(0, 3)),
        created_at: pastDate(),
      });
      specs.push({ ownerId: u.id, access, memberIds: [] });
    }
  }

  const channelRows: (typeof channel.$inferSelect)[] = [];
  for (let i = 0; i < channelValues.length; i += 500) {
    channelRows.push(
      ...(await db
        .insert(channel)
        .values(channelValues.slice(i, i + 500))
        .returning()),
    );
  }

  // Members for public + private channels (open channels let anyone add, so a
  // roster is moot there). Records the chosen ids on the spec for block/comment
  // authorship below.
  const memberValues: (typeof channelMember.$inferInsert)[] = [];
  channelRows.forEach((row, i) => {
    const spec = specs[i];
    if (spec.access === "open") return;
    const others = bulk.filter((u) => u.id !== spec.ownerId);
    spec.memberIds = sampleN(others, randInt(0, 8)).map((u) => u.id);
    for (const uid of spec.memberIds) {
      memberValues.push({ channel_id: row.id, user_id: uid, created_at: pastDate() });
    }
  });
  for (let i = 0; i < memberValues.length; i += 1000) {
    await db.insert(channelMember).values(memberValues.slice(i, i + 1000));
  }

  // Blocks. Authors are whoever may contribute: anyone for open channels, the
  // owner + members otherwise. `columnSpecIdx` keeps each block's channel spec so
  // comment authorship can respect who's allowed to read it.
  const columnValues: (typeof column.$inferInsert)[] = [];
  const columnSpecIdx: number[] = [];
  channelRows.forEach((row, i) => {
    const spec = specs[i];
    const authors =
      spec.access === "open" ? bulk.map((u) => u.id) : [spec.ownerId, ...spec.memberIds];
    for (let k = 0; k < randInt(3, 40); k++) {
      const isText = chance(0.5);
      columnValues.push({
        type: isText ? "text" : "url",
        title: chance(0.5) ? `${pick(ADJ)} ${pick(NOUN)}` : null,
        text: isText ? pick(SENTENCES) : null,
        url: isText ? null : `${pick(URLS)}/${randInt(1, 9999)}`,
        created_by: pick(authors),
        channel_id: row.id,
        tags: sampleN(TAGS, randInt(0, 2)),
        created_at: pastDate(),
      });
      columnSpecIdx.push(i);
    }
  });

  const columnRows: (typeof column.$inferSelect)[] = [];
  for (let i = 0; i < columnValues.length; i += 500) {
    columnRows.push(
      ...(await db
        .insert(column)
        .values(columnValues.slice(i, i + 500))
        .returning()),
    );
  }

  // Comments on a subset of blocks, authored by someone who can read them.
  const commentValues: (typeof comment.$inferInsert)[] = [];
  columnRows.forEach((col, j) => {
    if (!chance(0.3)) return;
    const spec = specs[columnSpecIdx[j]];
    const commenters =
      spec.access === "private" ? [spec.ownerId, ...spec.memberIds] : bulk.map((u) => u.id);
    if (commenters.length === 0) return;
    for (let x = 0; x < randInt(1, 3); x++) {
      commentValues.push({
        column_id: col.id,
        author_id: pick(commenters),
        body: pick(COMMENT_BODIES),
        created_at: pastDate(),
      });
    }
  });
  for (let i = 0; i < commentValues.length; i += 1000) {
    await db.insert(comment).values(commentValues.slice(i, i + 1000));
  }

  console.log(
    `Bulk: ${bulk.length} users, ${channelRows.length} channels, ${memberValues.length} memberships, ${columnRows.length} blocks, ${commentValues.length} comments.`,
  );
}

if (import.meta.main) {
  await seed();
  console.log("Seeded fixtures for", Object.keys(USERS).join(", "));
  process.exit(0);
}
