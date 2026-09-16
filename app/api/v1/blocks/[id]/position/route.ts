import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  attachPreview,
  json,
  reorderBlock,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/v1/blocks/:id/position — place a block in its channel's manual
// order. Body: `{ "after": <block id> }`, or `{ "after": null }` for the head.
//
// Its own endpoint rather than a field on PATCH /blocks/:id, because it is a
// different permission: PATCH is the channel owner *or* the block's creator,
// while a reorder rearranges everyone's blocks and is owner-only.
export async function PUT(req: Request, { params }: Ctx) {
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

  // `after` must be present and either a block id or null. Absent is rejected
  // rather than treated as null, so a client that forgot the field doesn't
  // silently send the block to the top of the channel.
  if (!("after" in body && (body.after === null || Number.isInteger(body.after)))) {
    return apiError("`after` must be a block id, or null to place it first.", 400);
  }
  const after = body.after as number | null;

  try {
    const result = await reorderBlock(blockId, after, auth.userId);
    if (result instanceof NextResponse) return result;
    logInfo("blocks.id.position.PUT", `moved block ${blockId} after ${after ?? "head"}`);
    return json({ block: await attachPreview(result) });
  } catch (e) {
    logError("blocks.id.position.PUT", `failed to reorder block ${blockId}`, e);
    return apiError("Failed to reorder block.", 500);
  }
}
