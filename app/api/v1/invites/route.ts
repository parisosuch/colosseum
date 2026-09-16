import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  createInviteCodeFor,
  json,
} from "@/lib/colosseum/api-auth";
import { getMyInviteCodes } from "@/lib/colosseum/invite";
import { getInviteQuota } from "@/lib/colosseum/admin";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/invites — the codes you have minted, and your allowance.
//
// Colosseum is invite-gated, so this is how anyone gets in. `quota.used` counts
// capacity minted rather than redemptions: it moves when a code is created or
// revoked, not when someone signs up with one.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const [codes, quota] = await Promise.all([
      getMyInviteCodes(auth.userId),
      getInviteQuota(auth.userId),
    ]);
    return json({ invites: codes, quota });
  } catch (e) {
    logError("invites.GET", `failed to list invites for ${auth.userId}`, e);
    return apiError("Failed to list invites.", 500);
  }
}

// POST /api/v1/invites — mint a code. Body: `{ "max_uses": 1, "note": "..." }`.
// `403` with the reason when it would exceed your allowance.
export async function POST(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // An empty body is fine — one use, no note.
  }

  const maxUses = body.max_uses === undefined ? 1 : Number(body.max_uses);
  if (!Number.isInteger(maxUses) || maxUses < 1) {
    return apiError("`max_uses` must be a positive integer.", 400);
  }
  const note = typeof body.note === "string" ? body.note : null;

  try {
    const result = await createInviteCodeFor(auth.userId, maxUses, note);
    if (result instanceof NextResponse) return result;
    logInfo("invites.POST", `minted an invite code for ${auth.userId} (${maxUses} uses)`);
    return json({ invite: result }, 201);
  } catch (e) {
    logError("invites.POST", `failed to mint an invite for ${auth.userId}`, e);
    return apiError("Failed to create an invite.", 500);
  }
}
