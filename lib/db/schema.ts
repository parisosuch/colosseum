// Drizzle schema — the single migration surface for every table, including the
// Better Auth ones (user/session/account/verification). Auth runs in-process
// and owns the `user` table here, so owner / creator / user columns carry real
// foreign keys with the same cascade behavior the old auth.users FKs had.
//
// The auth tables use uuid ids (Better Auth is configured with
// `generateId: "uuid"` in lib/auth.ts) so the pre-existing uuid user columns
// keep their type. Their property names are camelCase because the Better Auth
// Drizzle adapter looks fields up by its own field names.

import {
  bigint,
  boolean,
  integer,
  pgTable,
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

export const userProfile = pgTable("user_profile", {
  user_id: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  handle: text("handle").notNull().unique(),
  avatar_url: text("avatar_url"),
  about: text("about"),
});

export const channel = pgTable("channel", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  title: text("title").notNull(),
  description: text("description"),
  private: boolean("private").notNull().default(false),
  owner_id: uuid("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  updated_at: timestamp("updated_at", { withTimezone: true }),
  tags: text("tags").array().notNull().default([]),
});

// "column" is a reserved SQL keyword; Drizzle quotes the table name for us.
export const column = pgTable("column", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  type: text("type", { enum: ["url", "text", "image"] }).notNull(),
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
  tags: text("tags").array().notNull().default([]),
});

export const screenshot = pgTable("screenshot", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  url: text("url").notNull().unique(),
  image_url: text("image_url"),
  title: text("title"),
  captured_at: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  description: text("description"),
});

// Content-addressed file metadata. The bytes live on local disk at
// <sha[0:2]>/<sha> under STORAGE_DIR (see lib/colosseum/blob.ts); identical
// uploads share one row and one file.
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
