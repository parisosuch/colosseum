// One-shot: decode the grid poster frame for every stored video blob. Run it
// once after deploying this change so existing video blocks get a poster
// instead of falling back to a bare placeholder:
//   bun run backfill-video-posters
// Idempotent, and free once it has converged: it selects only blobs whose
// `has_thumbnail` is still false, so a settled deployment reads no rows and
// makes no storage calls. New uploads generate their poster at upload time, and
// anything missed here generates lazily on the first `?thumb` request (see
// lib/colosseum/blob.ts).
// Needs the DB + STORAGE_DIR populated, and ffmpeg on PATH (or FFMPEG_PATH).
//
// Separate from backfill-thumbnails on purpose: images need only sharp, which
// is always installed, while a poster needs ffmpeg. A deployment without it can
// skip this script entirely and lose nothing but the posters — which is why it
// checks for the binary first and exits rather than walking every video to fail
// on each one.

import { and, eq, like } from "drizzle-orm";

import { ensureThumbnail } from "@/lib/colosseum/blob";
import { ffmpegAvailable } from "@/lib/colosseum/video-frame";
import { db } from "@/lib/db";
import { blobs } from "@/lib/db/schema";

if (!(await ffmpegAvailable())) {
  console.error(
    "ffmpeg not found — install it (or set FFMPEG_PATH) and re-run. Video blocks still work; their cards just show a placeholder instead of a poster.",
  );
  process.exit(1);
}

// Only the blobs that still need it. Skipping the marked ones in the query is
// what keeps a re-run free: a deployment that has already converged selects no
// rows and touches storage zero times, instead of pulling every video out of
// the object store to learn the same thing.
const rows = await db
  .select({ sha256: blobs.sha256, mime: blobs.mime })
  .from(blobs)
  .where(and(like(blobs.mime, "video/%"), eq(blobs.has_thumbnail, false)));

let ok = 0;
let failed = 0;
// ponytail: sequential on purpose — each poster buffers a whole video (up to
// 100MB) and runs a decoder over it, so a parallel run would spike both memory
// and CPU. Batch with a small concurrency limit only if this gets slow.
for (const { sha256, mime } of rows) {
  try {
    await ensureThumbnail(sha256, mime);
    ok += 1;
  } catch (err) {
    // A missing file or a stream ffmpeg can't decode shouldn't stop the
    // backfill; that block keeps today's placeholder.
    failed += 1;
    console.warn(`skip ${sha256}: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`posters: ${ok} ready, ${failed} skipped, ${rows.length} video blobs`);
process.exit(0);
