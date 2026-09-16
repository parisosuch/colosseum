import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  json,
  revokeInviteCodeFor,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ code: string }> };

// DELETE /api/v1/invites/:code — revoke an unused code you created.
//
// Scoped to your own, unused codes: a spent or foreign code matches nothing and
// comes back successful rather than reporting whether it exists. The rows
// recording who joined through a used code are never touched.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { code } = await params;

  try {
    const denial = await revokeInviteCodeFor(code, auth.userId);
    if (denial) return denial;
    logInfo("invites.DELETE", `revoked an invite code for ${auth.userId}`);
    return json({ success: true });
  } catch (e) {
    logError("invites.DELETE", `failed to revoke an invite for ${auth.userId}`, e);
    return apiError("Failed to revoke that invite.", 500);
  }
}
