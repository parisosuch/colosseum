import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  authorizeChannelRead,
  authorizeChannelWrite,
  json,
} from "@/lib/colosseum/api-auth";
import { getChannel } from "@/lib/colosseum/channel";
import { deleteColumn, getColumn } from "@/lib/colosseum/column";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}

// GET /api/v1/blocks/:id — visible when its channel is public or owned.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const blockId = parseId((await params).id);
  if (blockId === null) return apiError("Invalid block id.", 400);

  const block = await getColumn(auth.supabase, blockId);
  if (!block) return apiError("Not found.", 404);

  const channel = await getChannel(auth.supabase, block.channel_id);
  const denied = authorizeChannelRead(channel, auth.userId);
  if (denied) return denied;

  return json({ block });
}

// Fields a block PATCH may set, by block type. title/description apply to any.
const EDITABLE_BY_TYPE: Record<string, string[]> = {
  text: ["title", "description", "text"],
  url: ["title", "description", "url"],
  image: ["title", "description", "image"],
};

// PATCH /api/v1/blocks/:id — owner-only. Partial update of the block's editable
// fields (only those valid for its type).
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const blockId = parseId((await params).id);
  if (blockId === null) return apiError("Invalid block id.", 400);

  const block = await getColumn(auth.supabase, blockId);
  if (!block) return apiError("Not found.", 404);

  const channel = await getChannel(auth.supabase, block.channel_id);
  const denied = authorizeChannelWrite(channel, auth.userId);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const allowed = EDITABLE_BY_TYPE[block.type] ?? ["title", "description"];
  const updates: Record<string, string> = {};
  for (const key of allowed) {
    if (typeof body[key] === "string") updates[key] = body[key] as string;
  }
  if (Object.keys(updates).length === 0) {
    return apiError(`No editable fields provided. Allowed: ${allowed.join(", ")}.`, 400);
  }

  const { data, error } = await auth.supabase
    .from("column")
    .update(updates)
    .eq("id", blockId)
    .select()
    .single();

  if (error) {
    console.error(error);
    return apiError("Failed to update block.", 500);
  }

  return json({ block: data });
}

// DELETE /api/v1/blocks/:id — owner-only.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const blockId = parseId((await params).id);
  if (blockId === null) return apiError("Invalid block id.", 400);

  const block = await getColumn(auth.supabase, blockId);
  if (!block) return apiError("Not found.", 404);

  const channel = await getChannel(auth.supabase, block.channel_id);
  const denied = authorizeChannelWrite(channel, auth.userId);
  if (denied) return denied;

  try {
    await deleteColumn(auth.supabase, blockId);
    return json({ success: true });
  } catch (e) {
    console.error(e);
    return apiError("Failed to delete block.", 500);
  }
}
