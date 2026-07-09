import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  authorizeChannelManage,
  authorizeChannelRead,
  json,
  parseAccess,
} from "@/lib/colosseum/api-auth";
import { deleteChannel, getChannel, updateChannel } from "@/lib/colosseum/channel";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}

// GET /api/v1/channels/:id — visible when public or owned.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = parseId((await params).id);
  if (channelId === null) return apiError("Invalid channel id.", 400);

  const channel = await getChannel(channelId);
  const denied = await authorizeChannelRead(channel, auth.userId);
  if (denied) return denied;

  return json({ channel });
}

// PATCH /api/v1/channels/:id — owner-only. Partial: unspecified fields keep
// their current value.
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = parseId((await params).id);
  if (channelId === null) return apiError("Invalid channel id.", 400);

  const channel = await getChannel(channelId);
  const denied = await authorizeChannelManage(channel, auth.userId);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : channel!.title;
  if (!title) return apiError("`title` cannot be empty.", 400);
  const description =
    typeof body.description === "string" ? body.description : channel!.description;
  const access = parseAccess(body, channel!.access);

  try {
    const updated = await updateChannel(channelId, {
      title,
      description,
      access,
    });
    logInfo("channels.id.PATCH", `updated channel ${channelId} for user ${auth.userId}`);
    return json({ channel: updated });
  } catch (e) {
    logError("channels.id.PATCH", `failed to update channel ${channelId}`, e);
    return apiError("Failed to update channel.", 500);
  }
}

// DELETE /api/v1/channels/:id — owner-only. Cascades to the channel's blocks.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = parseId((await params).id);
  if (channelId === null) return apiError("Invalid channel id.", 400);

  const channel = await getChannel(channelId);
  const denied = await authorizeChannelManage(channel, auth.userId);
  if (denied) return denied;

  try {
    await deleteChannel(channelId);
    logInfo("channels.id.DELETE", `deleted channel ${channelId} for user ${auth.userId}`);
    return json({ success: true });
  } catch (e) {
    logError("channels.id.DELETE", `failed to delete channel ${channelId}`, e);
    return apiError("Failed to delete channel.", 500);
  }
}
