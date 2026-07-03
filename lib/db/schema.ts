// Drizzle schema — the single migration surface for the app's own tables.
//
// These mirror the tables historically created by supabase/migrations/*. Owner
// / creator / user columns are plain `uuid` here rather than Drizzle foreign
// keys: they reference `auth.users`, which Supabase Auth still owns until Better
// Auth brings the user table under Drizzle. The real FK constraints live in the
// database; Drizzle just needs the column shape to query them.

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

export const userProfile = pgTable("user_profile", {
  user_id: uuid("user_id").primaryKey(),
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
  owner_id: uuid("owner_id").notNull(),
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
  created_by: uuid("created_by").notNull(),
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

export const apiToken = pgTable("api_token", {
  id: uuid("id").primaryKey().defaultRandom(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  user_id: uuid("user_id").notNull(),
  name: text("name"),
  token_prefix: text("token_prefix").notNull(),
  token_hash: text("token_hash").notNull().unique(),
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
});

export const inviteCode = pgTable("invite_code", {
  code: text("code").primaryKey(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  created_by: uuid("created_by"),
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
    user_id: uuid("user_id").notNull(),
    redeemed_at: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.user_id)],
);
