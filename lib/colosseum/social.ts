import "server-only";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { inviteCode, inviteRedemption, userProfile } from "@/lib/db/schema";

import type { UserProfile } from "./user";

// Colosseum is invite-only, so every account traces back through invites to the
// same root — the whole membership is one connected network. Explore therefore
// shows everyone; we only single out your *direct* friends (a one-hop invite
// edge) so they lead. The graph is implicit in the invite tables (an edge joins
// invite_code.created_by to each invite_redemption.user_id) — no new schema.

// User ids one invite-edge away from any of `userIds`: whoever they invited, and
// whoever invited them.
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

// Everyone shown under "everyone else": all members except the viewer and their
// direct friends (who lead in their own section). Pure so the partition is
// testable without a database.
export function otherMembers(
  self: string,
  friendIds: Iterable<string>,
  allIds: Iterable<string>,
): string[] {
  const exclude = new Set<string>([self, ...friendIds]);
  const out = new Set<string>();
  for (const id of allIds) {
    if (!exclude.has(id)) out.add(id);
  }
  return [...out];
}

function toProfile(row: typeof userProfile.$inferSelect): UserProfile {
  return {
    user_id: row.user_id,
    created_at: row.created_at.toISOString(),
    handle: row.handle,
    avatar_url: row.avatar_url ?? undefined,
    about: row.about ?? undefined,
  };
}

// The whole network for Explore, split into the viewer's direct friends and
// everyone else. Loads every profile once (fine for an invite-only member list;
// paginate if it ever gets large — ponytail: whole-table read, add paging when
// the member count warrants it).
export async function getSocialGraph(
  userId: string,
): Promise<{ friends: UserProfile[]; everyoneElse: UserProfile[] }> {
  const [friendSet, all] = await Promise.all([
    inviteNeighbors([userId]),
    db.select().from(userProfile).orderBy(userProfile.handle),
  ]);
  friendSet.delete(userId); // a self-invite edge shouldn't make you your own friend

  const otherIds = new Set(
    otherMembers(
      userId,
      friendSet,
      all.map((r) => r.user_id),
    ),
  );

  const friends = all.filter((r) => friendSet.has(r.user_id)).map(toProfile);
  const everyoneElse = all.filter((r) => otherIds.has(r.user_id)).map(toProfile);
  return { friends, everyoneElse };
}
