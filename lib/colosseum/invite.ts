import { and, desc, eq, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { inviteCode, inviteRedemption, user, userProfile } from "@/lib/db/schema";

export type InviteCode = {
  code: string;
  created_at: string;
  created_by: string | null;
  max_uses: number;
  uses: number;
  note: string | null;
  // Handles of the users who redeemed this code, so the invites page can link
  // to the accounts a code created. May be shorter than `uses` when a redeemer
  // hasn't finished onboarding (no profile/handle yet).
  redeemers: string[];
};

// Human-friendly alphabet: no 0/O/1/I to avoid transcription mistakes when a
// code is read aloud or copied from a screenshot.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = "";
  for (const b of bytes) {
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return out;
}

type InviteCodeRow = typeof inviteCode.$inferSelect;
function toInviteCode(row: InviteCodeRow): InviteCode {
  return {
    code: row.code,
    created_at: row.created_at.toISOString(),
    created_by: row.created_by,
    max_uses: row.max_uses,
    uses: row.uses,
    note: row.note,
    redeemers: [],
  };
}

// True once any account exists — sign-ups then require an invite code. The
// very first account (the self-hoster) is exempt: no one could have issued
// them a code yet. Replaces the old invite_required() Postgres RPC.
export async function inviteRequired(): Promise<boolean> {
  const [row] = await db.select({ id: user.id }).from(user).limit(1);
  return !!row;
}

// Atomically claim one use of a code. The `uses < max_uses` guard in the
// UPDATE row-locks the code and serialises concurrent redemptions, so `uses`
// can never exceed `max_uses`. Returns false for an unknown or spent code.
export async function claimInviteCode(code: string): Promise<boolean> {
  const rows = await db
    .update(inviteCode)
    .set({ uses: sql`${inviteCode.uses} + 1` })
    .where(and(eq(inviteCode.code, code), lt(inviteCode.uses, inviteCode.max_uses)))
    .returning({ code: inviteCode.code });
  return rows.length > 0;
}

// Audit row: which code a user redeemed at sign-up.
export async function recordInviteRedemption(code: string, userId: string): Promise<void> {
  await db.insert(inviteRedemption).values({ code, user_id: userId });
}

// Codes the member has minted, newest first. Scoped to the caller by the
// explicit created_by filter (this connection bypasses RLS).
export async function getMyInviteCodes(userId: string): Promise<InviteCode[]> {
  // Left-join redemptions (and their redeemer's profile) so each code carries
  // the handles it created. An unredeemed code yields a single row with a null
  // handle; a code used N times yields N rows.
  const rows = await db
    .select({ invite: inviteCode, handle: userProfile.handle })
    .from(inviteCode)
    .leftJoin(inviteRedemption, eq(inviteRedemption.code, inviteCode.code))
    .leftJoin(userProfile, eq(userProfile.user_id, inviteRedemption.user_id))
    .where(eq(inviteCode.created_by, userId))
    .orderBy(desc(inviteCode.created_at));

  const byCode = new Map<string, InviteCode>();
  for (const { invite, handle } of rows) {
    let entry = byCode.get(invite.code);
    if (!entry) {
      entry = toInviteCode(invite);
      byCode.set(invite.code, entry);
    }
    if (handle) {
      entry.redeemers.push(handle);
    }
  }
  return [...byCode.values()];
}

export async function createInviteCode(params: {
  created_by: string;
  max_uses?: number;
  note?: string | null;
}): Promise<InviteCode> {
  const [row] = await db
    .insert(inviteCode)
    .values({
      code: generateInviteCode(),
      created_by: params.created_by,
      max_uses: params.max_uses ?? 1,
      note: params.note ?? null,
    })
    .returning();
  return toInviteCode(row);
}

// A node in the invite network: one onboarded member (has a profile/handle).
export type InviteGraphNode = {
  user_id: string;
  handle: string;
  avatar_url: string | null;
  // How many people this member has successfully invited (out-degree). Drives
  // node sizing so prolific inviters read as hubs.
  invited_count: number;
};

// A directed edge inviter → invitee: `from` created the code `to` redeemed.
export type InviteGraphEdge = { from: string; to: string };

export type InviteGraph = { nodes: InviteGraphNode[]; edges: InviteGraphEdge[] };

// The whole invite network: every onboarded member is a node, and an edge runs
// from a code's creator to each redeemer. Members who neither invited nor were
// invited (via a surviving code) still appear, as disconnected dots. Edges are
// inner-joined to user_profile on both ends, so a redeemer still mid-onboarding
// — or a code whose creator has since been deleted (created_by set null) — just
// contributes no edge. Profiles are public, so the graph is unscoped.
export async function getInviteGraph(): Promise<InviteGraph> {
  const profiles = await db
    .select({
      user_id: userProfile.user_id,
      handle: userProfile.handle,
      avatar_url: userProfile.avatar_url,
    })
    .from(userProfile);

  const nodes = new Map<string, InviteGraphNode>(
    profiles.map((p) => [p.user_id, { ...p, invited_count: 0 }]),
  );

  const inviter = alias(userProfile, "inviter_profile");
  const invitee = alias(userProfile, "invitee_profile");
  const rows = await db
    .select({ fromId: inviter.user_id, toId: invitee.user_id })
    .from(inviteRedemption)
    .innerJoin(inviteCode, eq(inviteCode.code, inviteRedemption.code))
    .innerJoin(inviter, eq(inviter.user_id, inviteCode.created_by))
    .innerJoin(invitee, eq(invitee.user_id, inviteRedemption.user_id));

  const edges: InviteGraphEdge[] = [];
  for (const row of rows) {
    const from = nodes.get(row.fromId);
    if (from) from.invited_count += 1;
    edges.push({ from: row.fromId, to: row.toId });
  }

  return { nodes: [...nodes.values()], edges };
}

// Revoke one of the caller's own unused codes. Mirrors the old "delete own
// unused" RLS policy: a code owned by someone else, or already spent (uses > 0),
// matches no rows and is left intact — a spent code's invite_redemption audit
// row must survive.
export async function revokeInviteCode(code: string, userId: string): Promise<void> {
  await db
    .delete(inviteCode)
    .where(
      and(eq(inviteCode.code, code), eq(inviteCode.created_by, userId), eq(inviteCode.uses, 0)),
    );
}
