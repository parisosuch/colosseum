// Copy blobs that live on the local disk into the configured object store, so
// switching an already-running deployment to S3 doesn't orphan its existing
// images.
//
//   - No S3 configured → nothing to do (disk is the store).
//   - Otherwise → walk the blobs table and upload any object the bucket is
//     missing but disk has.
//
// Reads bytes straight off disk (not through the storage layer, which now
// points at S3) and uploads via putObject (which does). Provider-agnostic — no
// CLI, same aws4fetch path the app uses.
//
// Was `scripts/migrate-blobs.ts`, which kept its own marker object in the
// bucket to answer "has this run". The ledger answers that now, so the marker
// is gone; the failure semantics it was protecting are unchanged, expressed as
// `{ done: false }` instead — a partial run records nothing and retries.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { blobKey, thumbKey } from "@/lib/colosseum/blob";
import type { DataMigration } from "@/lib/colosseum/data-migration";
import { objectExists, putObject } from "@/lib/colosseum/storage";
import { db } from "@/lib/db";
import { blobs } from "@/lib/db/schema";

const migration: DataMigration = {
  id: "0001-sync-blobs-to-object-store",
  // Losing a blob copy costs images on old blocks, not the ability to serve.
  required: false,

  async run() {
    if (!process.env.S3_BUCKET) {
      console.log("blob sync: local disk backend, nothing to migrate.");
      return;
    }

    const storageDir = process.env.STORAGE_DIR ?? "./data/storage";
    const rows = await db.select({ sha256: blobs.sha256, mime: blobs.mime }).from(blobs);

    let uploaded = 0;
    let missing = 0;
    let failed = 0;

    // ponytail: sequential, like the thumbnail backfill — uploading every blob
    // at once would spike memory. Only the first boot after enabling S3 pays
    // this; add a small concurrency limit if a large library makes boot slow.
    for (const { sha256, mime } of rows) {
      for (const [key, type] of [
        [blobKey(sha256), mime],
        [thumbKey(sha256), "image/webp"],
      ] as const) {
        try {
          if (await objectExists(key)) {
            continue;
          }
          // No local copy is normal for a thumbnail that was never generated,
          // or a blob already living only in S3. Nothing to move.
          const bytes = await readFile(path.join(storageDir, key)).catch(() => null);
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

    if (failed > 0) {
      // Don't block serving on a partial sync, and don't record it as done —
      // the next boot picks up the rest.
      console.warn(`blob sync: ${uploaded} uploaded, ${failed} failed — will retry next boot.`);
      return { done: false };
    }

    console.log(`blob sync: done — ${uploaded} uploaded, ${missing} not on disk.`);
  },
};

export default migration;
