import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  attachPreview,
  json,
  nestChannel,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/v1/channels/:id/nest — add another channel as a block inside this
// one. `:id` is the host (the channel you own); the body names the one being
// linked. Body: `{ "channelId": <id> }`.
//
// Addressed from the host because that's where the new block lands and whose
// ownership is being exercised; the linked channel only has to be visible.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const hostChannelId = Number((await params).id);
  if (!Number.isInteger(hostChannelId)) return apiError("Invalid channel id.", 400);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const channelId = body.channelId;
  if (!Number.isInteger(channelId)) {
    return apiError("`channelId` is required — the channel to nest.", 400);
  }

  try {
    const result = await nestChannel(channelId as number, hostChannelId, auth.userId);
    if (result instanceof NextResponse) return result;
    logInfo("channels.id.nest.POST", `nested channel ${channelId} in ${hostChannelId}`);
    return json({ block: await attachPreview(result) }, 201);
  } catch (e) {
    logError("channels.id.nest.POST", `failed to nest ${channelId} in ${hostChannelId}`, e);
    return apiError("Failed to nest the channel.", 500);
  }
}
