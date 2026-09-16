import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  attachPreview,
  authorizeBlockWrite,
  authorizeChannelRead,
  json,
} from "@/lib/colosseum/api-auth";
import { getChannel } from "@/lib/colosseum/channel";
import { deleteColumn, getColumn, updateColumn, updateColumnTags } from "@/lib/colosseum/column";
import { triggerScreenshotCapture } from "@/lib/colosseum/screenshot";
import { normalizeTags } from "@/lib/tags";
import { logError, logInfo } from "@/lib/log";

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

  // The response returns the markdown source, so skip rendering it to HTML.
  const block = await getColumn(blockId, { html: false });
  if (!block) return apiError("Not found.", 404);

  const channel = await getChannel(block.channel_id);
  const denied = await authorizeChannelRead(channel, auth.userId);
  if (denied) return denied;

  return json({ block: await attachPreview(block) });
}

// Fields a block PATCH may set, by block type. title/description apply to any.
const EDITABLE_BY_TYPE: Record<string, string[]> = {
  text: ["title", "description", "text"],
  url: ["title", "description", "url"],
  image: ["title", "description", "image"],
  // The stored file isn't replaceable in place — a new one is a new block — so
  // these carry only the fields every type has. Without an entry at all they
  // would fall back to the same pair, but silently, and a reader would have to
  // know that to trust it.
  pdf: ["title", "description"],
  video: ["title", "description"],
};

// PATCH /api/v1/blocks/:id — channel owner or the block's creator. Partial
// update of the block's editable fields (only those valid for its type).
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const blockId = parseId((await params).id);
  if (blockId === null) return apiError("Invalid block id.", 400);

  const block = await getColumn(blockId, { html: false });
  if (!block) return apiError("Not found.", 404);

  const channel = await getChannel(block.channel_id);
  const denied = await authorizeBlockWrite(channel, block, auth.userId);
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

  // Tags are a `string[]` on every block type, so they don't fit the loop above
  // and are written separately (updateColumnTags is its own statement). Sending
  // `"tags": []` clears them, which is why presence is what counts rather than
  // length.
  if (body.tags !== undefined && !Array.isArray(body.tags)) {
    return apiError("`tags` must be an array of strings.", 400);
  }
  const tags = Array.isArray(body.tags) ? normalizeTags(body.tags) : null;

  if (Object.keys(updates).length === 0 && tags === null) {
    return apiError(`No editable fields provided. Allowed: ${allowed.join(", ")}, tags.`, 400);
  }

  try {
    if (tags !== null) await updateColumnTags(blockId, tags);
    // Nothing else to write when the request was tags-only; re-read so the
    // response carries them.
    const updated =
      Object.keys(updates).length > 0
        ? await updateColumn(blockId, updates)
        : (await getColumn(blockId, { html: false }))!;
    // A new url means a new preview to capture; skips itself if this URL is
    // already cached.
    if (block.type === "url" && typeof updates.url === "string") {
      triggerScreenshotCapture(updates.url, auth.userId);
    }
    const written = [...Object.keys(updates), ...(tags !== null ? ["tags"] : [])];
    logInfo("blocks.id.PATCH", `updated block ${blockId} (${written.join(", ")})`);
    return json({ block: await attachPreview(updated) });
  } catch (e) {
    logError("blocks.id.PATCH", `failed to update block ${blockId}`, e);
    return apiError("Failed to update block.", 500);
  }
}

// DELETE /api/v1/blocks/:id — channel owner or the block's creator.
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const blockId = parseId((await params).id);
  if (blockId === null) return apiError("Invalid block id.", 400);

  const block = await getColumn(blockId, { html: false });
  if (!block) return apiError("Not found.", 404);

  const channel = await getChannel(block.channel_id);
  const denied = await authorizeBlockWrite(channel, block, auth.userId);
  if (denied) return denied;

  try {
    await deleteColumn(blockId);
    logInfo("blocks.id.DELETE", `deleted block ${blockId}`);
    return json({ success: true });
  } catch (e) {
    logError("blocks.id.DELETE", `failed to delete block ${blockId}`, e);
    return apiError("Failed to delete block.", 500);
  }
}
