// One-shot: warm the grid thumbnail for every stored image blob. Run it once
// after deploying this change so existing images get thumbnails without anyone
// eating the one-time resize on first view:
//   bun run backfill-thumbnails
// Idempotent, and free once it has converged: it selects only blobs whose
// `has_thumbnail` is still false, so a settled deployment reads no rows and
// makes no storage calls. New uploads and anything missed here generate lazily
// on first `?thumb` request (see lib/colosseum/blob.ts).
// Needs the DB + STORAGE_DIR populated.
//
// The mark is what lets the serving route skip its storage probe. A blob left
// unmarked still serves correctly — it takes the lazy path and marks itself —
// so running this is a performance step, not a correctness one, and it is
// worth running after a deploy that adds the column so the first viewer of an
// old image doesn't pay for it.

import { and, eq, like } from "drizzle-orm";

import { ensureThumbnail } from "@/lib/colosseum/blob";
import { db } from "@/lib/db";
import { blobs } from "@/lib/db/schema";

// Only the blobs that still need it. Skipping the marked ones in the query is
// what keeps a re-run free: a deployment that has already converged selects no
// rows and touches storage zero times, instead of one HEAD per image to learn
// the same thing. An unmarked blob whose thumbnail does exist still costs that
// HEAD once, and marks itself on the way through.
const rows = await db
  .select({ sha256: blobs.sha256 })
  .from(blobs)
  .where(and(like(blobs.mime, "image/%"), eq(blobs.has_thumbnail, false)));

let ok = 0;
let failed = 0;
// ponytail: sequential on purpose — resizing every image at once would spike
// memory. Batch with a small concurrency limit only if this gets slow.
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
process.exit(0);
