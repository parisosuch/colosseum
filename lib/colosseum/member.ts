import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { channelMember, owner } from "@/lib/db/schema";
import { getPublicUserProfile, normalizeHandle } from "./user";
import { createNotification } from "./notification";
import { addGroupMemberByHandle, groupRole, type GroupMember, type GroupRole } from "./group";

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
      handle: owner.handle,
      avatar_url: owner.avatar_url,
    })
    .from(channelMember)
    .innerJoin(owner, eq(owner.user_id, channelMember.user_id))
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

// Add someone to a channel by handle and tell them about it. Shared by the web
// action and the API, which authorize it differently but owe the same notice.
//
// The notification fires only on a genuine add: re-adding an existing member is
// a no-op on the roster, and pinging them again for it would be noise.
//
// Authorization is the caller's — this assumes they may manage the channel.
// `channelOwnedBy` is the channel's owner id, used only to refuse adding the
// owner to their own channel, which would be a membership row that means
// nothing.
export async function addChannelMemberWithNotice(input: {
  channelId: number;
  handle: string;
  actorUserId: string;
  channelOwnedBy: string;
}): Promise<ChannelMember> {
  const normalized = normalizeHandle(input.handle);
  if (!normalized) throw new Error("Enter a handle.");

  const profile = await getPublicUserProfile(normalized);
  if (!profile) throw new Error("No user with that handle.");
  if (profile.owner_id === input.channelOwnedBy) {
    throw new Error("They already own this channel.");
  }

  const alreadyMember = await isChannelMember(input.channelId, profile.user_id);
  const member = await addChannelMemberByHandle(input.channelId, normalized);
  if (!alreadyMember) {
    await createNotification({
      recipient_id: profile.user_id,
      actor_id: input.actorUserId,
      type: "member",
      channel_id: input.channelId,
    });
  }
  return member;
}

// Resolve a handle to the user behind it, for removing them from a channel.
// The API addresses people by handle the way the rest of it does; the web app
// already holds the user id from the roster it rendered.
export async function removeChannelMemberByHandle(
  channel_id: number,
  handle: string,
): Promise<void> {
  const normalized = normalizeHandle(handle);
  if (!normalized) throw new Error("Enter a handle.");
  const profile = await getPublicUserProfile(normalized);
  if (!profile) throw new Error("No user with that handle.");
  await removeChannelMember(channel_id, profile.user_id);
}

// The group analogue of addChannelMemberWithNotice: add someone to a group by
// handle, and tell them, once.
//
// Lives here rather than in group.ts because that module is imported by
// viewer.ts, and `group -> notification -> activity -> viewer -> group` is a
// cycle. Nothing in the notification chain imports this module, which is what
// lets the channel version sit here too.
//
// A role change on someone already in the group sends nothing — they know they
// are in it. An unknown handle is left for addGroupMemberByHandle to reject.
export async function addGroupMemberWithNotice(input: {
  groupId: string;
  handle: string;
  role: Exclude<GroupRole, "owner">;
  actorUserId: string;
}): Promise<GroupMember> {
  const profile = await getPublicUserProfile(normalizeHandle(input.handle));
  const alreadyMember = profile ? await groupRole(input.groupId, profile.user_id) : null;
  const member = await addGroupMemberByHandle(input.groupId, input.handle, input.role);
  if (!alreadyMember) {
    await createNotification({
      recipient_id: member.user_id,
      actor_id: input.actorUserId,
      type: "member",
      group_id: input.groupId,
    });
  }
  return member;
}
