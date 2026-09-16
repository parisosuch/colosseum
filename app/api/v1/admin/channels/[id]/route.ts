import { NextResponse } from "next/server";

import { adminDeleteChannel, authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/v1/admin/channels/:id — moderation: remove a channel you don't
// own, and its blocks. A private channel is a 404, as for a block.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = Number((await params).id);
  if (!Number.isInteger(channelId)) return apiError("Invalid channel id.", 400);

  try {
    const denial = await adminDeleteChannel(channelId, auth.userId);
    if (denial) return denial;
    logInfo("admin.channels.DELETE", `admin ${auth.userId} removed channel ${channelId}`);
    return json({ success: true });
  } catch (e) {
    logError("admin.channels.DELETE", `failed to remove channel ${channelId}`, e);
    return apiError("Failed to remove that channel.", 500);
  }
}
