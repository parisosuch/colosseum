// Boot-time sync: copy blobs that live on the local disk into the configured
// object store, so switching an already-running deployment to S3 doesn't orphan
// its existing images. Runs from entrypoint.sh on every boot; a marker object
// makes the done case a single HEAD.
//
//   - No S3 configured  → nothing to do (disk is the store).
//   - Marker present     → already synced; skip. New uploads since then went
//                          straight to S3, so nothing is ever left behind.
//   - Otherwise          → walk the blobs table, upload any object the bucket
//                          is missing but disk has. Re-runnable: an interrupted
//                          run resumes (objectExists skips what's already up),
//                          and the marker is only written once every blob made
//                          it, so a partial failure retries next boot.
//
// Reads bytes straight off disk (not through the storage layer, which now
// points at S3) and uploads via putObject (which does). Provider-agnostic — no
// CLI, same aws4fetch path the app uses.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { blobKey, thumbKey } from "@/lib/colosseum/blob";
import { objectExists, putObject } from "@/lib/colosseum/storage";
import { db } from "@/lib/db";
import { blobs } from "@/lib/db/schema";

if (!process.env.S3_BUCKET) {
  console.log("blob sync: local disk backend, nothing to migrate.");
  process.exit(0);
}

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./data/storage";
const MARKER = ".blobs-migrated";

if (await objectExists(MARKER)) {
  console.log("blob sync: already migrated.");
  process.exit(0);
}

const rows = await db.select({ sha256: blobs.sha256, mime: blobs.mime }).from(blobs);

let uploaded = 0;
let missing = 0;
let failed = 0;

// ponytail: sequential, like backfill-thumbnails — uploading every blob at once
// would spike memory. Only the first boot after enabling S3 pays this; add a
// small concurrency limit if a large library makes boot too slow.
for (const { sha256, mime } of rows) {
  for (const [key, type] of [
    [blobKey(sha256), mime],
    [thumbKey(sha256), "image/webp"],
  ] as const) {
    try {
      if (await objectExists(key)) {
        continue;
      }
      // No local copy is normal for a thumbnail that was never generated, or a
      // blob already living only in S3. Nothing to move.
      const bytes = await readFile(path.join(STORAGE_DIR, key)).catch(() => null);
      if (!bytes) {
        missing += 1;
        continue;
      }
      await putObject(key, bytes, type);
      uploaded += 1;
    } catch (err) {
      failed += 1;
      console.warn(`blob sync skip ${key}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

if (failed === 0) {
  // Leave the marker only on a clean pass, so a run with failures retries on
  // the next boot instead of being marked done.
  await putObject(MARKER, Buffer.from(""), "text/plain");
  console.log(`blob sync: done — ${uploaded} uploaded, ${missing} not on disk.`);
} else {
  // Don't block serving on a partial sync; the next boot picks up the rest.
  console.warn(`blob sync: ${uploaded} uploaded, ${failed} failed — will retry next boot.`);
}

process.exit(0);
