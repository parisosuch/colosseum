import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json, revokeApiTokenFor } from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/v1/tokens/:id — revoke one of your tokens.
//
// Revoking the token making the request is allowed, and is the honest way to
// hand back access. It takes effect immediately, so the next call with it gets
// a 401 — `GET /api/v1/tokens` marks that token `current: true` so this is a
// choice rather than an accident.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const denial = await revokeApiTokenFor(id, auth.userId);
    if (denial) return denial;
    logInfo("tokens.DELETE", `revoked token ${id} for ${auth.userId}`);
    return json({ success: true, revoked_current: id === auth.tokenId });
  } catch (e) {
    logError("tokens.DELETE", `failed to revoke token ${id}`, e);
    return apiError("Failed to revoke that token.", 500);
  }
}
