import { and, desc, eq, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { inviteCode, inviteRedemption, user } from "@/lib/db/schema";

export type InviteCode = {
  code: string;
  created_at: string;
  created_by: string | null;
  max_uses: number;
  uses: number;
  note: string | null;
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
  const rows = await db
    .select()
    .from(inviteCode)
    .where(eq(inviteCode.created_by, userId))
    .orderBy(desc(inviteCode.created_at));
  return rows.map(toInviteCode);
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
