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
import { blobDiskPath, getMedia } from "@/lib/colosseum/blob";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const filePath = blobDiskPath(item.sha256);
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // A media id's bytes never change, so public responses cache forever;
  // private ones must never land in any cache.
  const cacheControl =
    item.visibility === "private" ? "private, no-store" : "public, max-age=31536000, immutable";

  // Node's web-stream type doesn't structurally match the DOM lib's, hence
  // the unknown hop; at runtime they're the same thing.
  return new Response(Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream, {
    headers: {
      "Content-Type": item.mime,
      "Content-Length": String(fileStat.size),
      "Cache-Control": cacheControl,
    },
  });
}
