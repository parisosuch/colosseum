import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json, removeMemberFor } from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; handle: string }> };

// DELETE /api/v1/channels/:id/members/:handle — take someone off the roster.
// Owner only. To give up your own membership use
// DELETE /api/v1/channels/:id/members/me, which any member may call.
//
// That sibling route is a static segment, so Next matches it ahead of this one
// and `me` can never address a member here. Safe only because a handle is at
// least HANDLE_MIN_LENGTH (3) characters, so no account can be called "me" —
// if that minimum ever drops to two, one user becomes unremovable through this
// route and the `me` route starts answering for them.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { id, handle } = await params;
  const channelId = Number(id);
  if (!Number.isInteger(channelId)) return apiError("Invalid channel id.", 400);

  try {
    const denial = await removeMemberFor(channelId, handle, auth.userId);
    if (denial) return denial;
    logInfo("channels.members.DELETE", `removed ${handle} from channel ${channelId}`);
    return json({ success: true });
  } catch (e) {
    logError("channels.members.DELETE", `failed to remove ${handle} from ${channelId}`, e);
    return apiError("Failed to remove member.", 500);
  }
}
