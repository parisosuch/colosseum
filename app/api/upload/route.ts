// Start a resumable video upload (see lib/colosseum/upload.ts). Returns an
// upload id the client then PATCHes chunks to. Auth + validation happen here,
// once, so an unauthorized or oversized upload never gets a partial file.

import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { authorizeChannelContribute } from "@/lib/colosseum/api-auth";
import { ALLOWED_VIDEO_TYPES, MAX_VIDEO_BYTES } from "@/lib/colosseum/blob";
import { getChannel } from "@/lib/colosseum/channel";
import { createUpload, sweepStaleUploads } from "@/lib/colosseum/upload";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    channelId?: unknown;
    mime?: unknown;
    size?: unknown;
    filename?: unknown;
  } | null;
  const channelId = Number(body?.channelId);
  const mime = typeof body?.mime === "string" ? body.mime : "";
  const size = Number(body?.size);
  const filename = typeof body?.filename === "string" ? body.filename : "video";

  if (!Number.isInteger(channelId) || !ALLOWED_VIDEO_TYPES.includes(mime)) {
    return NextResponse.json({ error: "Only video files are supported." }, { status: 400 });
  }
  if (!Number.isInteger(size) || size <= 0) {
    return NextResponse.json({ error: "Bad upload size." }, { status: 400 });
  }
  if (size > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "That video is too large (max 100MB)." }, { status: 413 });
  }

  const channel = await getChannel(channelId);
  const denied = await authorizeChannelContribute(channel, user.id);
  if (denied) return denied;

  // Opportunistically GC abandoned partials so they don't pile up on disk.
  await sweepStaleUploads().catch(() => {});

  const id = await createUpload({
    ownerId: user.id,
    channelId,
    mime,
    size,
    filename,
    createdAt: Date.now(),
  });
  return NextResponse.json({ id, offset: 0 });
}
