// Warm the grid thumbnail for every stored image blob, so existing images get
// one without a viewer eating the resize on first view.
//
// Free once converged: it selects only blobs whose `has_thumbnail` is still
// false, so a settled deployment reads no rows and makes no storage calls. New
// uploads and anything missed here generate lazily on the first `?thumb`
// request (see lib/colosseum/blob.ts).
//
// The mark is what lets the serving route skip its storage probe. A blob left
// unmarked still serves correctly — it takes the lazy path and marks itself —
// so this is a performance step, not a correctness one, which is why it is not
// `required`.

import { and, eq, like } from "drizzle-orm";

import { ensureThumbnail } from "@/lib/colosseum/blob";
import type { DataMigration } from "@/lib/colosseum/data-migration";
import { db } from "@/lib/db";
import { blobs } from "@/lib/db/schema";

const migration: DataMigration = {
  id: "0002-mark-existing-thumbnails",
  required: false,

  async run() {
    // Only the blobs that still need it. Skipping the marked ones in the query
    // is what keeps a re-run free: a converged deployment selects no rows and
    // touches storage zero times, instead of one HEAD per image to learn the
    // same thing. An unmarked blob whose thumbnail does exist still costs that
    // HEAD once, and marks itself on the way through.
    const rows = await db
      .select({ sha256: blobs.sha256 })
      .from(blobs)
      .where(and(like(blobs.mime, "image/%"), eq(blobs.has_thumbnail, false)));

    let ok = 0;
    let failed = 0;
    // ponytail: sequential on purpose — resizing every image at once would
    // spike memory. Batch with a small concurrency limit only if this gets slow.
    for (const { sha256 } of rows) {
      try {
        await ensureThumbnail(sha256);
        ok += 1;
      } catch (err) {
        // A missing file or an undecodable blob shouldn't stop the backfill.
        failed += 1;
        console.warn(`skip ${sha256}: ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(`thumbnails: ${ok} ready, ${failed} skipped, ${rows.length} image blobs`);
    // A blob that failed here is not lost — it generates lazily on first view —
    // so this converges even with skips, and recording it is honest.
  },
};

export default migration;
