import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json, revokeShareLinkFor } from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/v1/share-links/:id — revoke a share link. It stops working on the
// next request to it. Managers of the link's channel only.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const denial = await revokeShareLinkFor(id, auth.userId);
    if (denial) return denial;
    logInfo("share-links.DELETE", `revoked share link ${id}`);
    return json({ success: true });
  } catch (e) {
    logError("share-links.DELETE", `failed to revoke share link ${id}`, e);
    return apiError("Failed to revoke that share link.", 500);
  }
}
