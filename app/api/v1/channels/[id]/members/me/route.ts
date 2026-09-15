import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, leaveChannel } from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

// DELETE /api/v1/channels/:id/members/me — give up your own membership of a
// channel someone else owns. Scoped to `me` rather than a general member route:
// removing *other* people is roster management, which stays in the app.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const channelId = Number(id);
  if (!Number.isInteger(channelId)) return apiError("Invalid channel id.", 400);

  try {
    const denial = await leaveChannel(channelId, auth.userId);
    if (denial) return denial;
    logInfo("channels.members.me.DELETE", `user ${auth.userId} left channel ${channelId}`);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    logError(
      "channels.members.me.DELETE",
      `failed to remove user ${auth.userId} from channel ${channelId}`,
      e,
    );
    return apiError("Failed to leave the channel.", 500);
  }
}
