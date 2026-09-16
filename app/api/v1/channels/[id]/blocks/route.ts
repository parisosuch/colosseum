import { NextResponse } from "next/server";

import {
  authenticateApiToken,
  apiError,
  attachPreview,
  attachPreviews,
  authorizeChannelContribute,
  authorizeChannelRead,
  createFileBlock,
  json,
} from "@/lib/colosseum/api-auth";
import { assertColumnQuota } from "@/lib/colosseum/admin";
import { putImageBlobFromUrl } from "@/lib/colosseum/blob";
import { getChannel, viewerScope } from "@/lib/colosseum/channel";
import {
  getChannelColumnCount,
  getChannelColumns,
  getColumn,
  updateColumnTags,
  uploadImageColumn,
  uploadTextColumn,
  uploadURLColumn,
} from "@/lib/colosseum/column";
import { triggerScreenshotCapture } from "@/lib/colosseum/screenshot";
import { ingestUrlColumn } from "@/lib/colosseum/ingest";
import { normalizeTags } from "@/lib/tags";
import { logError, logInfo } from "@/lib/log";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}

// GET /api/v1/channels/:id/blocks — list a channel's blocks (visible when the
// channel is public or owned). Optional ?limit=N&offset=N, newest first, with
// the channel's whole `total` alongside the page.
export async function GET(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = parseId((await params).id);
  if (channelId === null) return apiError("Invalid channel id.", 400);

  const channel = await getChannel(channelId);
  const denied = await authorizeChannelRead(channel, auth.userId);
  if (denied) return denied;

  const search = new URL(req.url).searchParams;
  const limitParam = search.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return apiError("`limit` must be a positive integer.", 400);
  }
  const offsetParam = search.get("offset");
  const offset = offsetParam ? Number(offsetParam) : undefined;
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    return apiError("`offset` must be a non-negative integer.", 400);
  }

  try {
    // `limit` is optional, so this can be every block in the channel; the
    // response carries the markdown source, so none of them are rendered.
    //
    // `total` is the channel's whole count, not the page's, so a client can
    // tell a short page from the end of the channel and knows when to stop —
    // without it, reading past the newest N meant guessing.
    const [blocks, total] = await Promise.all([
      getChannelColumns(channelId, { limit, offset, html: false }, await viewerScope(auth.userId)),
      getChannelColumnCount(channelId),
    ]);
    return json({ blocks: await attachPreviews(blocks), total });
  } catch (e) {
    logError("channels.id.blocks.GET", `failed to list blocks for channel ${channelId}`, e);
    return apiError("Failed to list blocks.", 500);
  }
}

// POST /api/v1/channels/:id/blocks — add a block. Who may add depends on the
// channel's access mode (owner for public, anyone for open, owner/member for
// private). Body:
//   { "type": "text", "text": "..." }
//   { "type": "url", "url": "https://..." }
//   { "type": "image", "image": "https://...(public url)" }
// A url block's preview captures in the background (skipped if this URL is
// already cached) — poll GET .../blocks/:id and watch for `preview` to land.
export async function POST(req: Request, { params }: Ctx) {
  const auth = await authenticateApiToken(req);
  if (auth instanceof NextResponse) return auth;

  const channelId = parseId((await params).id);
  if (channelId === null) return apiError("Invalid channel id.", 400);

  const channel = await getChannel(channelId);
  const denied = await authorizeChannelContribute(channel, auth.userId);
  if (denied) return denied;

  // Same per-user block quota the server actions enforce — API uploads count too.
  try {
    await assertColumnQuota(auth.userId);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Block limit reached.", 403);
  }

  // A multipart body means real bytes: an uploaded image, a PDF, or a video.
  // Checked before req.json(), which would otherwise consume the stream and
  // fail. The file's own mime picks the block type.
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return apiError("Invalid multipart body.", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return apiError("`file` is required for a multipart upload.", 400);
    }
    try {
      const result = await createFileBlock(channelId, { file }, auth.userId);
      if (result instanceof NextResponse) return result;
      logInfo(
        "channels.id.blocks.POST",
        `created ${result.type} block ${result.id} in channel ${channelId} from an upload`,
      );
      return json({ block: await attachPreview(result) }, 201);
    } catch (e) {
      logError("channels.id.blocks.POST", `upload failed for channel ${channelId}`, e);
      return apiError("Failed to store that file.", 500);
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const type = body.type;
  const base = { created_by: auth.userId, channel_id: channelId };

  if (body.tags !== undefined && !Array.isArray(body.tags)) {
    return apiError("`tags` must be an array of strings.", 400);
  }
  const tags = Array.isArray(body.tags) ? normalizeTags(body.tags) : [];

  try {
    let block;
    if (type === "text") {
      if (typeof body.text !== "string" || !body.text.trim()) {
        return apiError("`text` is required for a text block.", 400);
      }
      block = await uploadTextColumn({ ...base, text: body.text });
    } else if (type === "url") {
      if (typeof body.url !== "string" || !body.url.trim()) {
        return apiError("`url` is required for a url block.", 400);
      }
      const url = body.url.trim();
      // A tweet, a YouTube video, a GitHub repo and so on each become their own
      // kind of block, the same as a link pasted into the web app. `detect:
      // false` keeps it a plain link — the escape hatch for a caller that wants
      // the screenshot card, or that is adding a link whose host is slow.
      block =
        body.detect === false
          ? await uploadURLColumn({ ...base, text: url })
          : await ingestUrlColumn({
              url,
              userId: auth.userId,
              channelId,
              channelPrivate: channel!.private,
            });
      // Only a block that stayed a plain link wants a screenshot; the richer
      // types render from data fetched during the ingest.
      if (block.type === "url") triggerScreenshotCapture(url, auth.userId);
    } else if (type === "image") {
      if (typeof body.image !== "string" || !body.image.trim()) {
        return apiError("`image` (a public image URL) is required for an image block.", 400);
      }
      // Fetch and store the image so it's thumbnailed and self-hosted, rather
      // than persisting a third-party URL that skips compression. A bad or
      // unreachable URL is the client's fault, so surface it as a 422 instead of
      // the generic 500 below.
      let image: string;
      try {
        image = await putImageBlobFromUrl(
          body.image.trim(),
          auth.userId,
          channel!.private ? "private" : "public",
        );
      } catch (e) {
        return apiError(e instanceof Error ? e.message : "Couldn't fetch that image.", 422);
      }
      block = await uploadImageColumn({ ...base, image });
    } else if (type === "pdf" || type === "video") {
      // Given as a URL the server fetches, not bytes — the JSON path stays
      // JSON. Post multipart to hand over a local file instead.
      const source = body[type];
      if (typeof source !== "string" || !source.trim()) {
        return apiError(`\`${type}\` must be a URL for a ${type} block.`, 400);
      }
      const result = await createFileBlock(channelId, { url: source.trim() }, auth.userId);
      if (result instanceof NextResponse) return result;
      block = result;
    } else {
      return apiError("`type` must be one of: text, url, image, pdf, video.", 400);
    }
    // The upload helpers take no tags, so this is a second write — the same two
    // steps the web app makes when adding a block and then tagging it.
    if (tags.length > 0) {
      await updateColumnTags(block.id, tags);
      block = (await getColumn(block.id, { html: false })) ?? block;
    }
    logInfo(
      "channels.id.blocks.POST",
      `created ${type} block ${block.id} in channel ${channelId} for user ${auth.userId}`,
    );
    return json({ block: await attachPreview(block) }, 201);
  } catch (e) {
    logError(
      "channels.id.blocks.POST",
      `failed to create ${type} block in channel ${channelId}`,
      e,
    );
    return apiError("Failed to create block.", 500);
  }
}
