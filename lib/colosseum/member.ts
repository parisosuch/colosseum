import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { channelMember, userProfile } from "@/lib/db/schema";
import { getPublicUserProfile } from "./user";

// A member of a private channel, carrying the profile fields the manage dialog
// needs to render and link the row.
export type ChannelMember = {
  user_id: string;
  handle: string;
  avatar_url?: string;
  created_at: string;
};

// True when `user_id` has an explicit membership row for the channel. The owner
// is an implicit member and has no row, so callers check ownership separately.
export async function isChannelMember(channel_id: number, user_id: string): Promise<boolean> {
  const [row] = await db
    .select({ user_id: channelMember.user_id })
    .from(channelMember)
    .where(and(eq(channelMember.channel_id, channel_id), eq(channelMember.user_id, user_id)))
    .limit(1);
  return !!row;
}

// The channel's members (excluding the implicit owner), oldest first, joined to
// their profile so the manage dialog can show a handle and avatar.
export async function listChannelMembers(channel_id: number): Promise<ChannelMember[]> {
  const rows = await db
    .select({
      user_id: channelMember.user_id,
      created_at: channelMember.created_at,
      handle: userProfile.handle,
      avatar_url: userProfile.avatar_url,
    })
    .from(channelMember)
    .innerJoin(userProfile, eq(userProfile.user_id, channelMember.user_id))
    .where(eq(channelMember.channel_id, channel_id))
    .orderBy(asc(channelMember.created_at));
  return rows.map((r) => ({
    user_id: r.user_id,
    handle: r.handle,
    avatar_url: r.avatar_url ?? undefined,
    created_at: r.created_at.toISOString(),
  }));
}

// Add the user with `handle` to the channel. Throws if no such handle exists.
// Idempotent: re-adding an existing member is a no-op that returns their row.
// Callers must authorize ownership first (this connection bypasses RLS).
export async function addChannelMemberByHandle(
  channel_id: number,
  handle: string,
): Promise<ChannelMember> {
  const profile = await getPublicUserProfile(handle);
  if (!profile) {
    throw new Error("No user with that handle.");
  }
  const [row] = await db
    .insert(channelMember)
    .values({ channel_id, user_id: profile.user_id })
    .onConflictDoNothing()
    .returning();
  return {
    user_id: profile.user_id,
    handle: profile.handle,
    avatar_url: profile.avatar_url,
    // A conflict (already a member) returns no row; fall back to now.
    created_at: (row?.created_at ?? new Date()).toISOString(),
  };
}

// Remove a member. A no-op if they weren't one. Callers authorize ownership.
export async function removeChannelMember(channel_id: number, user_id: string): Promise<void> {
  await db
    .delete(channelMember)
    .where(and(eq(channelMember.channel_id, channel_id), eq(channelMember.user_id, user_id)));
}
