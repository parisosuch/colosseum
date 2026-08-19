// Decode the grid poster frame for every stored video blob, so existing video
// blocks get a poster instead of a bare placeholder.
//
// Separate from the image thumbnails on purpose: images need only sharp, which
// is always installed, while a poster needs ffmpeg. A deployment without it
// loses nothing but the posters.
//
// That missing binary is why this reports `{ done: false }` rather than
// recording itself: ffmpeg may be installed on a later deploy, and a ledger row
// written today would mean the posters never get generated. The check is one
// `which` per boot, so waiting costs nothing.

import { and, eq, like } from "drizzle-orm";

import { ensureThumbnail } from "@/lib/colosseum/blob";
import type { DataMigration } from "@/lib/colosseum/data-migration";
import { ffmpegAvailable } from "@/lib/colosseum/video-frame";
import { db } from "@/lib/db";
import { blobs } from "@/lib/db/schema";

const migration: DataMigration = {
  id: "0003-mark-existing-video-posters",
  required: false,

  async run() {
    if (!(await ffmpegAvailable())) {
      console.warn(
        "ffmpeg not found — skipping video posters. Video blocks still work; their cards show a placeholder until ffmpeg is installed (or FFMPEG_PATH is set) and the container restarts.",
      );
      return { done: false };
    }

    // Only the blobs that still need it, for the same reason as the image pass.
    const rows = await db
      .select({ sha256: blobs.sha256, mime: blobs.mime })
      .from(blobs)
      .where(and(like(blobs.mime, "video/%"), eq(blobs.has_thumbnail, false)));

    let ok = 0;
    let failed = 0;
    // ponytail: sequential on purpose — each poster buffers a whole video (up
    // to 100MB) and runs a decoder over it, so a parallel run would spike both
    // memory and CPU. Batch with a small concurrency limit only if this gets
    // slow.
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
  },
};

export default migration;
