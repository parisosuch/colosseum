// Serves stored bytes for one media reference (see lib/colosseum/blob.ts).
// This is the only route that serves blob bytes; nothing serves them by hash,
// so dedup can never leak a private image through a public URL.
//
// Private media is owner-only, which matches channel access today: private
// channels are readable only by their owner, and media visibility is kept in
// sync with the owning channel's privacy. Signed URLs stay deferred — a
// single-container deploy has no shared cache in front of this route.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { blobDiskPath, ensureThumbnail, getMedia } from "@/lib/colosseum/blob";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const item = await getMedia(id);
  if (!item) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (item.visibility === "private") {
    const user = await getSessionUser();
    // 404, not 403, so a private image's existence never leaks.
    if (user?.id !== item.owner_id) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  }

  // `?thumb` serves a downsized webp derived from the same bytes (used by grid
  // previews). Generation is idempotent + cached on disk; a non-image blob (or
  // any failure) falls back to the full bytes.
  let filePath = blobDiskPath(item.sha256);
  let contentType = item.mime;
  if (req.nextUrl.searchParams.has("thumb")) {
    const thumb = await ensureThumbnail(item.sha256).catch(() => null);
    if (thumb) {
      filePath = thumb;
      contentType = "image/webp";
    }
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // A media id's bytes never change, so public responses cache forever;
  // private ones must never land in any cache.
  const cacheControl =
    item.visibility === "private" ? "private, no-store" : "public, max-age=31536000, immutable";

  // Honor a byte-range request (video seeking; Safari won't play a video at all
  // without it). Absent/unparseable Range → full 200 as before. `?thumb` bytes
  // are tiny, so range there just falls through to the full response.
  const size = fileStat.size;
  const range = req.headers.get("range");
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : size - Number(match[2]);
    const end = match[1] && match[2] ? Number(match[2]) : size - 1;
    if (start > end || start < 0 || end >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
      });
    }
    return new Response(
      Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream,
      {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": cacheControl,
        },
      },
    );
  }

  // Node's web-stream type doesn't structurally match the DOM lib's, hence
  // the unknown hop; at runtime they're the same thing.
  return new Response(Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
    },
  });
}
