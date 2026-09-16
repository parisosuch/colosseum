import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json, transferChannelFor } from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/v1/channels/:id/transfer — move a channel to another owner: a group
// you administer, or back to yourself. Body: `{ "to": "studio" }`.
//
// You must own the channel now and be able to manage where it is going.
//
// Ownership is what grants access to a private channel, so a transfer changes
// who can read it. The channel's own member roster is deliberately left alone.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = Number((await params).id);
  if (!Number.isInteger(channelId)) return apiError("Invalid channel id.", 400);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  if (typeof body.to !== "string" || !body.to.trim()) {
    return apiError("`to` is required — a handle to transfer the channel to.", 400);
  }

  try {
    const result = await transferChannelFor(channelId, body.to.trim(), auth.userId);
    if (result instanceof NextResponse) return result;
    logInfo("channels.transfer.POST", `transferred channel ${channelId} to ${body.to}`);
    return json({ channel: result });
  } catch (e) {
    logError("channels.transfer.POST", `failed to transfer channel ${channelId}`, e);
    return apiError("Failed to transfer the channel.", 500);
  }
}
