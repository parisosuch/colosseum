import { cache } from "react";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { owner } from "@/lib/db/schema";

// The `owner` table's data layer: everything that holds a handle and can own
// channels. Today every row is `kind = "user"`, one per person, created at
// onboarding beside their user_profile. Groups are the second kind and land in
// a later change; the read helpers here already treat kind as data rather than
// assuming it, so they keep working when they arrive.
//
// Per-person reads (handle, avatar, bio for a signed-in user) go through
// ./user, which joins this table to user_profile and filters to kind "user".
// This module is for callers that mean an owner whatever kind it is.

export type OwnerKind = "user" | "group";

export type Owner = {
  id: string;
  kind: OwnerKind;
  handle: string;
  avatar_url?: string;
  about?: string;
  created_at: string;
  // Set exactly when kind is "user" (a check constraint enforces the pairing).
  user_id?: string;
};

type OwnerRow = typeof owner.$inferSelect;
export function toOwner(row: OwnerRow): Owner {
  return {
    id: row.id,
    kind: row.kind,
    handle: row.handle,
    avatar_url: row.avatar_url ?? undefined,
    about: row.about ?? undefined,
    created_at: row.created_at.toISOString(),
    user_id: row.user_id ?? undefined,
  };
}

// Wrapped in React cache() so one render shares a single lookup — a channel page
// resolves its owner for the header, the breadcrumb and the metadata.
export const getOwner = cache(async (id: string): Promise<Owner | null> => {
  const [row] = await db.select().from(owner).where(eq(owner.id, id)).limit(1);
  return row ? toOwner(row) : null;
});

export const getOwnerByHandle = cache(async (handle: string): Promise<Owner | null> => {
  const [row] = await db.select().from(owner).where(eq(owner.handle, handle)).limit(1);
  return row ? toOwner(row) : null;
});

// The owner row a person acts as. Every user gets one at onboarding, so a null
// here means they haven't finished it — the same condition ./user reports by
// returning a null profile, and callers treat it the same way.
//
// Singular today because a person owns exactly one thing. When a user can also
// act for the groups they belong to, this becomes the list of owner ids they may
// act for, and the visibility predicates that call it move from an equality to a
// membership test.
export const ownerIdForUser = cache(async (user_id: string): Promise<string | null> => {
  const [row] = await db
    .select({ id: owner.id })
    .from(owner)
    .where(eq(owner.user_id, user_id))
    .limit(1);
  return row?.id ?? null;
});

// The owner id a person acts as, for the paths that cannot proceed without one
// (creating a channel, listing your own). A user reaches these only through the
// API, since the app redirects an un-onboarded session to pick a handle first,
// so the message names the fix rather than reporting a missing row.
export async function requireOwnerId(user_id: string): Promise<string> {
  const id = await ownerIdForUser(user_id);
  if (!id) {
    throw new Error("Finish setting up your profile first.");
  }
  return id;
}

// The people to notify about something that happened to an owner's channel.
// A notification's recipient is a user_id — a group cannot receive email or
// carry an unread count — so anything addressed to "the owner" has to resolve
// through here rather than using an owner id directly.
//
// One person today. For a group this becomes its admins, which is why it
// returns a list and why callers fan out over it instead of taking [0].
export async function ownerRecipients(owner_id: string): Promise<string[]> {
  const [row] = await db
    .select({ user_id: owner.user_id })
    .from(owner)
    .where(eq(owner.id, owner_id))
    .limit(1);
  return row?.user_id ? [row.user_id] : [];
}
