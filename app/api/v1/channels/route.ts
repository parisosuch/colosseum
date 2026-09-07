import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, json, parseAccess } from "@/lib/colosseum/api-auth";
import { createChannel, getOwnerChannels } from "@/lib/colosseum/channel";
import { ownerIdForUser, requireOwnerId } from "@/lib/colosseum/owner";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

// GET /api/v1/channels — the token owner's channels.
export async function GET(req: Request) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    // No owner row means onboarding is unfinished, so there is nothing to list.
    const ownerId = await ownerIdForUser(auth.userId);
    const channels = ownerId ? await getOwnerChannels(ownerId) : [];
    return json({ channels });
  } catch (e) {
    logError("channels.GET", `failed to list channels for user ${auth.userId}`, e);
    return apiError("Failed to list channels.", 500);
  }
}

// POST /api/v1/channels — create a channel owned by the token user.
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

  try {
    const channel = await createChannel({
      title,
      description,
      access,
      // owner is always the token user's own owner row; any client-supplied
      // owner is ignored.
      owned_by: await requireOwnerId(auth.userId),
    });
    logInfo("channels.POST", `created channel ${channel.id} for user ${auth.userId}`);
    return json({ channel }, 201);
  } catch (e) {
    logError("channels.POST", `failed to create channel for user ${auth.userId}`, e);
    return apiError("Failed to create channel.", 500);
  }
}
