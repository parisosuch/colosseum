// Serves stored blob bytes from local disk (see lib/colosseum/blob.ts).
// Content-addressed URLs never change meaning, so responses cache forever.
//
// ponytail: blobs are served publicly, matching the public Supabase buckets
// this replaces; per-blob visibility/authz is a planned follow-up.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextRequest, NextResponse } from "next/server";

import { blobDiskPath, getBlobMeta } from "@/lib/colosseum/blob";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ sha: string }> }) {
  const { sha } = await ctx.params;
  // The sha is used to build a filesystem path, so reject anything that isn't
  // a lowercase hex sha256 before it gets near path.join.
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const meta = await getBlobMeta(sha);
  const filePath = blobDiskPath(sha);
  const fileStat = meta && (await stat(filePath).catch(() => null));
  if (!meta || !fileStat) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Node's web-stream type doesn't structurally match the DOM lib's, hence
  // the unknown hop; at runtime they're the same thing.
  return new Response(Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream, {
    headers: {
      "Content-Type": meta.mime,
      "Content-Length": String(fileStat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
