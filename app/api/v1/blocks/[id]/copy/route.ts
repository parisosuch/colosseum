import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  attachPreview,
  copyBlock,
  json,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/v1/blocks/:id/copy — put a copy of this block in another channel,
// leaving the original where it is. Body: `{ "channelId": <id> }`.
//
// Distinct from a move (PATCH can't change `channel_id`, and move takes the
// block away): a copy is a new block with its own id and its own media
// reference, so the two can be deleted independently.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const blockId = Number((await params).id);
  if (!Number.isInteger(blockId)) return apiError("Invalid block id.", 400);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const channelId = body.channelId;
  if (!Number.isInteger(channelId)) {
    return apiError("`channelId` is required.", 400);
  }

  try {
    const result = await copyBlock(blockId, channelId as number, auth.userId);
    if (result instanceof NextResponse) return result;
    logInfo("blocks.id.copy.POST", `copied block ${blockId} into channel ${channelId}`);
    return json({ block: await attachPreview(result) }, 201);
  } catch (e) {
    logError("blocks.id.copy.POST", `failed to copy block ${blockId}`, e);
    return apiError("Failed to copy block.", 500);
  }
}
