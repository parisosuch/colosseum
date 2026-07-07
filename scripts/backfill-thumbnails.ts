// One-shot: warm the grid thumbnail for every stored image blob. Run it once
// after deploying this change so existing images get thumbnails without anyone
// eating the one-time resize on first view:
//   bun run backfill-thumbnails
// Idempotent (ensureThumbnail skips images already generated), so re-running is
// a cheap stat per image and safe. New uploads and anything missed here
// generate lazily on first `?thumb` request (see lib/colosseum/blob.ts).
// Needs the DB + STORAGE_DIR populated.

import { like } from "drizzle-orm";

import { ensureThumbnail } from "@/lib/colosseum/blob";
import { db } from "@/lib/db";
import { blobs } from "@/lib/db/schema";

const rows = await db
  .select({ sha256: blobs.sha256 })
  .from(blobs)
  .where(like(blobs.mime, "image/%"));

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
