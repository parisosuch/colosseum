import { NextResponse } from "next/server";

import { authenticateApiToken, apiError, deleteCommentFor, json } from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/v1/comments/:id — remove a comment. Its author always may;
// otherwise the block's channel owner may moderate it.
//
// Addressed by comment id rather than nested under the block, because a comment
// id is what `GET /api/v1/blocks/:id/comments` hands back and the block adds
// nothing to identifying it.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const commentId = Number((await params).id);
  if (!Number.isInteger(commentId)) return apiError("Invalid comment id.", 400);

  try {
    const denial = await deleteCommentFor(commentId, auth.userId);
    if (denial) return denial;
    logInfo("comments.DELETE", `deleted comment ${commentId}`);
    return json({ success: true });
  } catch (e) {
    logError("comments.DELETE", `failed to delete comment ${commentId}`, e);
    return apiError("Failed to delete comment.", 500);
  }
}
