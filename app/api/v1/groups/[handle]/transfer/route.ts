import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  json,
  transferGroupOwnershipFor,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ handle: string }> };

// POST /api/v1/groups/:handle/transfer — hand the group to another member.
// Owner only. Body: `{ "to": "alice" }`.
//
// One statement demotes the current owner and promotes the new one, because a
// partial unique index enforces exactly one owner per group.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { handle } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  if (typeof body.to !== "string" || !body.to.trim()) {
    return apiError("`to` is required — the handle to hand the group to.", 400);
  }

  try {
    const denial = await transferGroupOwnershipFor(handle, body.to.trim(), auth.userId);
    if (denial) return denial;
    logInfo("groups.transfer.POST", `transferred ${handle} to ${body.to}`);
    return json({ success: true });
  } catch (e) {
    logError("groups.transfer.POST", `failed to transfer ${handle}`, e);
    return apiError("Failed to transfer the group.", 500);
  }
}
