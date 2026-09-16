import { NextResponse } from "next/server";

import { adminDeleteBlock, authenticateApiToken, apiError, json } from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/v1/admin/blocks/:id — moderation: remove a block you don't own.
//
// A block in a private channel is a 404. Moderation covers what is public; an
// admin is not a passkey into someone's private collection.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const blockId = Number((await params).id);
  if (!Number.isInteger(blockId)) return apiError("Invalid block id.", 400);

  try {
    const denial = await adminDeleteBlock(blockId, auth.userId);
    if (denial) return denial;
    logInfo("admin.blocks.DELETE", `admin ${auth.userId} removed block ${blockId}`);
    return json({ success: true });
  } catch (e) {
    logError("admin.blocks.DELETE", `failed to remove block ${blockId}`, e);
    return apiError("Failed to remove that block.", 500);
  }
}
