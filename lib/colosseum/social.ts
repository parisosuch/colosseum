import "server-only";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { inviteCode, inviteRedemption, userProfile } from "@/lib/db/schema";

import type { UserProfile } from "./user";

// The social graph is implicit in the invite graph: an edge exists between an
// inviter (invite_code.created_by) and each person who redeemed one of their
// codes (invite_redemption.user_id). Friends are your direct edges; friends-of-
// friends are one hop further out. The app is invite-only, so this graph is the
// whole social network. No new tables — just a read layer over invites.

// User ids one invite-edge away from any of `userIds`: whoever they invited, and
// whoever invited them. Batched so friends-of-friends is one pair of queries,
// not two per friend.
async function inviteNeighbors(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const [invited, invitedBy] = await Promise.all([
    // People who redeemed a code created by one of userIds.
    db
      .select({ id: inviteRedemption.user_id })
      .from(inviteCode)
      .innerJoin(inviteRedemption, eq(inviteRedemption.code, inviteCode.code))
      .where(inArray(inviteCode.created_by, userIds)),
    // People who created the code redeemed by one of userIds.
    db
      .select({ id: inviteCode.created_by })
      .from(inviteRedemption)
      .innerJoin(inviteCode, eq(inviteCode.code, inviteRedemption.code))
      .where(inArray(inviteRedemption.user_id, userIds)),
  ]);

  const out = new Set<string>();
  for (const r of invited) out.add(r.id);
  for (const r of invitedBy) if (r.id) out.add(r.id); // created_by is nullable
  return out;
}

// Given the viewer, their friends, and the raw neighbors of those friends, the
// friends-of-friends are those neighbors minus the viewer and their direct
// friends. Pure so the graph arithmetic is testable without a database.
export function friendsOfFriends(
  self: string,
  friendIds: Iterable<string>,
  neighborsOfFriends: Iterable<string>,
): string[] {
  const exclude = new Set<string>([self, ...friendIds]);
  const out = new Set<string>();
  for (const id of neighborsOfFriends) {
    if (!exclude.has(id)) out.add(id);
  }
  return [...out];
}

async function loadProfiles(userIds: string[]): Promise<UserProfile[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select()
    .from(userProfile)
    .where(inArray(userProfile.user_id, userIds))
    .orderBy(userProfile.handle);
  return rows.map((row) => ({
    user_id: row.user_id,
    created_at: row.created_at.toISOString(),
    handle: row.handle,
    avatar_url: row.avatar_url ?? undefined,
    about: row.about ?? undefined,
  }));
}

// The viewer's friends and friends-of-friends, as profiles (users without a
// profile — signed up but not onboarded — are dropped, since they have no
// handle to link to).
export async function getSocialGraph(
  userId: string,
): Promise<{ friends: UserProfile[]; friendsOfFriends: UserProfile[] }> {
  const friendSet = await inviteNeighbors([userId]);
  friendSet.delete(userId); // a self-invite edge shouldn't make you your own friend
  const friendIds = [...friendSet];

  const fofRaw = await inviteNeighbors(friendIds);
  const fofIds = friendsOfFriends(userId, friendIds, fofRaw);

  const [friends, fof] = await Promise.all([loadProfiles(friendIds), loadProfiles(fofIds)]);
  return { friends, friendsOfFriends: fof };
}
