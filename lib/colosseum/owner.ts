import { cache } from "react";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { owner } from "@/lib/db/schema";
import { groupRecipients } from "./group";

// The `owner` table's data layer: everything that holds a handle and can own
// channels. A row is either a person (`kind = "user"`, one per account, created
// at onboarding beside their user_profile) or a group (see ./group). The reads
// here treat kind as data, so they answer for both.
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
// Singular: this is the person's *own* owner row, which is what a channel they
// create belongs to. The wider question — every owner they may act for, groups
// included — is a ViewerScope, see ./viewer.
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
// One person for a personal owner; a group's owner and admins, since a
// notification is something someone has to act on and a twenty-person group
// should not all receive the same one.
export async function ownerRecipients(owner_id: string): Promise<string[]> {
  const [row] = await db
    .select({ user_id: owner.user_id, kind: owner.kind })
    .from(owner)
    .where(eq(owner.id, owner_id))
    .limit(1);
  if (!row) return [];
  if (row.kind === "group") return groupRecipients(owner_id);
  return row.user_id ? [row.user_id] : [];
}
