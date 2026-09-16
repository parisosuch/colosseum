import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  createCommentFor,
  json,
  listCommentsFor,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/blocks/:id/comments — what has been said about a block. Visible
// to anyone who can read the block.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const blockId = Number((await params).id);
  if (!Number.isInteger(blockId)) return apiError("Invalid block id.", 400);

  try {
    const result = await listCommentsFor(blockId, auth.userId);
    if (result instanceof NextResponse) return result;
    return json({ comments: result });
  } catch (e) {
    logError("blocks.comments.GET", `failed to list comments on ${blockId}`, e);
    return apiError("Failed to list comments.", 500);
  }
}

// POST /api/v1/blocks/:id/comments — leave a comment. Body: `{ "body": "..." }`.
// Any reader may comment. `@handle` mentions notify the person named, if they
// can read the channel.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const blockId = Number((await params).id);
  if (!Number.isInteger(blockId)) return apiError("Invalid block id.", 400);

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  if (typeof payload.body !== "string") return apiError("`body` is required.", 400);

  try {
    const result = await createCommentFor(blockId, payload.body, auth.userId);
    if (result instanceof NextResponse) return result;
    logInfo("blocks.comments.POST", `commented on block ${blockId}`);
    return json({ comment: result }, 201);
  } catch (e) {
    logError("blocks.comments.POST", `failed to comment on ${blockId}`, e);
    return apiError("Failed to post comment.", 500);
  }
}
