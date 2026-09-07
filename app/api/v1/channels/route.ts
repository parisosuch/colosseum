import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json, parseAccess } from "@/lib/colosseum/api-auth";
import { createChannel, getViewerChannels, viewerScope } from "@/lib/colosseum/channel";
import { resolveCreateOwner } from "@/lib/colosseum/owner";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/channels — every channel the token's user holds as an owner:
// their own, plus those of each group they belong to. Each carries the `handle`
// its link needs, which for a group's channel is the group's, not the user's.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const channels = await getViewerChannels(await viewerScope(auth.userId));
    return json({ channels });
  } catch (e) {
    logError("channels.GET", `failed to list channels for user ${auth.userId}`, e);
    return apiError("Failed to list channels.", 500);
  }
}

// POST /api/v1/channels — create a channel. Owned by the token's user unless
// `owner` names a group they manage.
export async function POST(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return apiError("`title` is required.", 400);
  }
  const description = typeof body.description === "string" ? body.description : undefined;
  const access = parseAccess(body, "public");
  const ownerHandle = typeof body.owner === "string" ? body.owner : undefined;

  // Resolved before the try below so a bad or unpermitted owner comes back as a
  // 403 naming the reason, rather than a 500 that says only "failed to create".
  let ownedBy: string;
  try {
    ownedBy = await resolveCreateOwner(auth.userId, ownerHandle);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Invalid owner.", 403);
  }

  try {
    const channel = await createChannel({ title, description, access, owned_by: ownedBy });
    logInfo("channels.POST", `created channel ${channel.id} for user ${auth.userId}`);
    return json({ channel }, 201);
  } catch (e) {
    logError("channels.POST", `failed to create channel for user ${auth.userId}`, e);
    return apiError("Failed to create channel.", 500);
  }
}
