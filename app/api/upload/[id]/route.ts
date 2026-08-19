// Resume + append for a resumable video upload (see lib/colosseum/upload.ts).
//
// GET   → the byte offset the server holds, so a client resuming after a refresh
//         knows where to continue.
// PATCH → append one chunk at `Upload-Offset`. On the chunk that completes the
//         file, assemble it into a blob + media reference and create the video
//         column, returning it so the board can render the new block.

import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { authorizeChannelContribute } from "@/lib/colosseum/api-auth";
import { createMedia, ensureThumbnail, putBlob } from "@/lib/colosseum/blob";
import { getChannel } from "@/lib/colosseum/channel";
import { uploadVideoColumn } from "@/lib/colosseum/column";
import {
  appendUploadChunk,
  cleanupUpload,
  getUploadMeta,
  getUploadOffset,
  readAssembledUpload,
} from "@/lib/colosseum/upload";

export const runtime = "nodejs";

// Resolve the upload and confirm the caller owns it. 404 for missing/other-owner
// so a partial's existence never leaks.
async function ownedUpload(id: string) {
  const user = await getSessionUser();
  const meta = await getUploadMeta(id);
  if (!user || !meta || meta.ownerId !== user.id) return null;
  return { user, meta };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = await ownedUpload(id);
  if (!found) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ offset: await getUploadOffset(id), size: found.meta.size });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = await ownedUpload(id);
  if (!found) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const { user, meta } = found;

  const offset = Number(req.headers.get("upload-offset"));
  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "Missing or bad Upload-Offset." }, { status: 400 });
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  let result;
  try {
    result = await appendUploadChunk(id, offset, bytes, meta);
  } catch {
    return NextResponse.json({ error: "Upload failed." }, { status: 400 });
  }
  // Out of sync: tell the client the real offset (409) so it can resume from there.
  if (!result.ok) {
    return NextResponse.json({ error: "Offset mismatch.", offset: result.offset }, { status: 409 });
  }

  // More to come — ack the new offset.
  if (result.offset < meta.size) {
    return NextResponse.json({ offset: result.offset });
  }

  // Complete. Re-authorize (the channel could have changed since create), then
  // hand the assembled bytes to the blob store and create the column.
  const channel = await getChannel(meta.channelId);
  const denied = await authorizeChannelContribute(channel, user.id);
  if (denied) {
    await cleanupUpload(id);
    return denied;
  }
  const full = await readAssembledUpload(id);
  const sha256 = await putBlob(full, meta.mime, user.id);
  // Decode the poster frame before the block exists, so its card never has a
  // window where it has to fall back. Best-effort — a deployment without ffmpeg
  // still gets the block, just without a poster.
  await ensureThumbnail(sha256, meta.mime).catch(() => {});
  const image = await createMedia(sha256, user.id, channel!.private ? "private" : "public");
  const column = await uploadVideoColumn({
    created_by: user.id,
    channel_id: meta.channelId,
    image,
  });
  await cleanupUpload(id);
  return NextResponse.json({ done: true, offset: result.offset, column });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = await ownedUpload(id);
  if (!found) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await cleanupUpload(id);
  return NextResponse.json({ ok: true });
}
