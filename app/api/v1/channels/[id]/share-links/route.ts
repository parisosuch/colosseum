import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  createShareLinkFor,
  json,
  listShareLinksFor,
} from "@/lib/colosseum/api-auth";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/channels/:id/share-links — the channel's live share links, block
// links included, newest first. Channel managers only.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = Number((await params).id);
  if (!Number.isInteger(channelId)) return apiError("Invalid channel id.", 400);

  try {
    const result = await listShareLinksFor(channelId, auth.userId);
    if (result instanceof NextResponse) return result;
    return json({ share_links: result });
  } catch (e) {
    logError("channels.share-links.GET", `failed to list share links of ${channelId}`, e);
    return apiError("Failed to list share links.", 500);
  }
}

// POST /api/v1/channels/:id/share-links — make a share link to a private
// channel. Body (all optional): `{ "block_id": 12, "label": "for Sam",
// "expires_in_days": 30 }`. `block_id` makes a link to that one block;
// `expires_in_days` defaults to 30, and null means the link never expires. The
// response's `url` holds the token and is never shown again.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = Number((await params).id);
  if (!Number.isInteger(channelId)) return apiError("Invalid channel id.", 400);

  let body: Record<string, unknown> = {};
  const raw = await req.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body.", 400);
    }
  }

  try {
    const result = await createShareLinkFor(
      channelId,
      { blockId: body.block_id, label: body.label, expiresInDays: body.expires_in_days },
      auth.userId,
    );
    if (result instanceof NextResponse) return result;
    logInfo("channels.share-links.POST", `made share link ${result.share_link.id} on ${channelId}`);
    return json(result, 201);
  } catch (e) {
    logError("channels.share-links.POST", `failed to make a share link on ${channelId}`, e);
    return apiError("Failed to make a share link.", 500);
  }
}
