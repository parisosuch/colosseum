import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  authorizeChannelRead,
  authorizeChannelWrite,
  json,
} from "@/lib/colosseum/api-auth";
import { getChannel } from "@/lib/colosseum/channel";
import {
  getChannelColumns,
  uploadImageColumn,
  uploadTextColumn,
  uploadURLColumn,
} from "@/lib/colosseum/column";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}

// GET /api/v1/channels/:id/blocks — list a channel's blocks (visible when the
// channel is public or owned). Optional ?limit=N.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = parseId((await params).id);
  if (channelId === null) return apiError("Invalid channel id.", 400);

  const channel = await getChannel(auth.supabase, channelId);
  const denied = authorizeChannelRead(channel, auth.userId);
  if (denied) return denied;

  const limitParam = new URL(req.url).searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return apiError("`limit` must be a positive integer.", 400);
  }

  try {
    const blocks = await getChannelColumns(auth.supabase, channelId, limit);
    return json({ blocks });
  } catch (e) {
    console.error(e);
    return apiError("Failed to list blocks.", 500);
  }
}

// POST /api/v1/channels/:id/blocks — add a block (owner-only). Body:
//   { "type": "text", "text": "..." }
//   { "type": "url", "url": "https://..." }
//   { "type": "image", "image": "https://...(public url)" }
// URL blocks are not screenshotted here — the web capture flow stays UI-only.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = parseId((await params).id);
  if (channelId === null) return apiError("Invalid channel id.", 400);

  const channel = await getChannel(auth.supabase, channelId);
  const denied = authorizeChannelWrite(channel, auth.userId);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const type = body.type;
  const base = { created_by: auth.userId, channel_id: channelId };

  try {
    let block;
    if (type === "text") {
      if (typeof body.text !== "string" || !body.text.trim()) {
        return apiError("`text` is required for a text block.", 400);
      }
      block = await uploadTextColumn(auth.supabase, { ...base, text: body.text });
    } else if (type === "url") {
      if (typeof body.url !== "string" || !body.url.trim()) {
        return apiError("`url` is required for a url block.", 400);
      }
      // uploadURLColumn stores its `text` arg as the block's url.
      block = await uploadURLColumn(auth.supabase, { ...base, text: body.url.trim() });
    } else if (type === "image") {
      if (typeof body.image !== "string" || !body.image.trim()) {
        return apiError("`image` (a public URL) is required for an image block.", 400);
      }
      block = await uploadImageColumn(auth.supabase, { ...base, image: body.image.trim() });
    } else {
      return apiError("`type` must be one of: text, url, image.", 400);
    }
    return json({ block }, 201);
  } catch (e) {
    console.error(e);
    return apiError("Failed to create block.", 500);
  }
}
