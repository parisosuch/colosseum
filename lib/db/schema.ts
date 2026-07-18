// Drizzle schema — the single migration surface for every table, including the
// Better Auth ones (user/session/account/verification). Auth runs in-process
// and owns the `user` table here, so owner / creator / user columns carry real
// foreign keys with the same cascade behavior the old auth.users FKs had.
//
// The auth tables use uuid ids (Better Auth is configured with
// `generateId: "uuid"` in lib/auth.ts) so the pre-existing uuid user columns
// keep their type. Their property names are camelCase because the Better Auth
// Drizzle adapter looks fields up by its own field names.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Better Auth tables
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// App tables
// ---------------------------------------------------------------------------

export const userProfile = pgTable(
  "user_profile",
  {
    user_id: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    handle: text("handle").notNull().unique(),
    avatar_url: text("avatar_url"),
    about: text("about"),
  },
  (t) => [
    // Explore feed orders new members by join time.
    index("user_profile_created_at_idx").on(t.created_at),
  ],
);

export const channel = pgTable(
  "channel",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    title: text("title").notNull(),
    description: text("description"),
    // Access mode: `public` (all read, owner writes), `open` (all read, anyone
    // writes), `private` (owner + channel_member rows read and write).
    access: text("access", { enum: ["public", "open", "private"] })
      .notNull()
      .default("public"),
    owner_id: uuid("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    updated_at: timestamp("updated_at", { withTimezone: true }),
    tags: text("tags").array().notNull().default([]),
  },
  (t) => [
    // Explore feed orders newly created channels by time.
    index("channel_created_at_idx").on(t.created_at),
    // getUserChannels / getUserPublicChannels filtering on owner_id.
    index("channel_owner_id_idx").on(t.owner_id),
    // Channel search. It ORs `tags @> ARRAY[...]` with ILIKE '%term%' across
    // title/description, so every OR branch needs an index or the planner
    // seq-scans the whole thing: a GIN for tag containment plus trigram GINs
    // (pg_trgm) for the substring matches.
    index("channel_tags_gin_idx").using("gin", t.tags),
    index("channel_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    index("channel_description_trgm_idx").using("gin", sql`${t.description} gin_trgm_ops`),
  ],
);

// Members of a `private` channel: everyone here (plus the owner, who is an
// implicit member and never stored) may read and add to the channel. Meaningless
// for public/open channels. Both FKs cascade, so a row vanishes with its channel
// or its user.
export const channelMember = pgTable(
  "channel_member",
  {
    channel_id: bigint("channel_id", { mode: "number" })
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channel_id, t.user_id] })],
);

// "column" is a reserved SQL keyword; Drizzle quotes the table name for us.
export const column = pgTable(
  "column",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    type: text("type", { enum: ["url", "text", "image", "channel", "pdf", "tweet"] }).notNull(),
    title: text("title"),
    description: text("description"),
    url: text("url"),
    text: text("text"),
    image: text("image"),
    created_by: uuid("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel_id: bigint("channel_id", { mode: "number" })
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    // Set only for `channel` columns: the channel this column links to. Cascades,
    // so the column disappears if the linked channel is deleted.
    linked_channel_id: bigint("linked_channel_id", { mode: "number" }).references(
      () => channel.id,
      {
        onDelete: "cascade",
      },
    ),
    tags: text("tags").array().notNull().default([]),
  },
  (t) => [
    // Explore feed orders newly added blocks by time.
    index("column_created_at_idx").on(t.created_at),
    // getChannelColumns / getChannelColumnCount filtering and sorting on channel_id, created_at.
    index("column_channel_id_created_at_idx").on(t.channel_id, t.created_at.desc()),
    // Screenshot GC checks whether any column still references a url (exact
    // match — this btree stays for equality lookups; the trigram index below is
    // only for ILIKE search).
    index("column_url_idx").on(t.url),
    // Cascade delete + withLinkedChannels look up columns by linked channel.
    index("column_linked_channel_id_idx").on(t.linked_channel_id),
    // Block search. Same shape as channel search: `tags @> ARRAY[...]` ORed with
    // ILIKE '%term%' across title/description/text/url. A tag GIN plus a trigram
    // GIN (pg_trgm) per searched column so no OR branch forces a seq scan.
    index("column_tags_gin_idx").using("gin", t.tags),
    index("column_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    index("column_description_trgm_idx").using("gin", sql`${t.description} gin_trgm_ops`),
    index("column_text_trgm_idx").using("gin", sql`${t.text} gin_trgm_ops`),
    index("column_url_trgm_idx").using("gin", sql`${t.url} gin_trgm_ops`),
  ],
);

// Comments on a block ("column"). Anyone who can read the block can post; the
// author or the block's channel owner can delete. Cascades on both FKs so a
// comment vanishes with its block or its author.
export const comment = pgTable(
  "comment",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    column_id: bigint("column_id", { mode: "number" })
      .notNull()
      .references(() => column.id, { onDelete: "cascade" }),
    author_id: uuid("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
  },
  // A block's comment thread is fetched by column_id, oldest first.
  (t) => [index("comment_column_id_created_at_idx").on(t.column_id, t.created_at)],
);

export const screenshot = pgTable("screenshot", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  url: text("url").notNull().unique(),
  image_url: text("image_url"),
  title: text("title"),
  captured_at: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  description: text("description"),
});

// Deletion-resilient snapshot of an embedded tweet, keyed by its snowflake id
// and shared across every `tweet` column that links it (like `screenshot` is
// shared per URL). Captured once when a tweet block is first added, then served
// from here forever — we never re-fetch, so a later deletion on X can't
// overwrite the copy. `data` is the react-tweet `Tweet` object with its media
// URLs already rewritten to self-hosted `/api/media/<id>` blobs; `media_urls`
// lists those references so they can be GC'd when the last block is removed.
export const tweet = pgTable("tweet", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  media_urls: text("media_urls").array().notNull().default([]),
  captured_at: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

// Content-addressed file metadata. The bytes live in the pluggable object
// store keyed <sha[0:2]>/<sha> (local disk or S3; see lib/colosseum/blob.ts);
// identical uploads share one row and one object.
export const blobs = pgTable("blobs", {
  sha256: text("sha256").primaryKey(),
  mime: text("mime").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  created_by: uuid("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// One reference to a blob. Visibility lives here, never on the blob:
// content-addressing dedupes identical bytes into one blob, so the same bytes
// can back a public and a private image at once. URLs carry media.id — no
// endpoint serves bytes by hash. Deleting a blobs row is FK-restricted while
// any media row still references it (the reference count).
export const media = pgTable("media", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  owner_id: uuid("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  blob_sha256: text("blob_sha256")
    .notNull()
    .references(() => blobs.sha256),
  visibility: text("visibility", { enum: ["public", "private"] }).notNull(),
});

export const apiToken = pgTable("api_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name"),
  token_prefix: text("token_prefix").notNull(),
  token_hash: text("token_hash").notNull().unique(),
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
});

export const inviteCode = pgTable("invite_code", {
  code: text("code").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  created_by: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
  max_uses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  note: text("note"),
});

export const inviteRedemption = pgTable(
  "invite_redemption",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    code: text("code")
      .notNull()
      .references(() => inviteCode.code, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    redeemed_at: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.user_id)],
);
