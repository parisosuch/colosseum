// One-shot reverse of scripts/migrate-blobs.ts: drain the object store back to
// local disk, for moving a deployment off S3. Run it *while S3 is still
// configured* (it reads through the active S3 backend), then unset S3_BUCKET
// and redeploy on the local-disk default:
//   bun run export-blobs
//
// Idempotent — a blob already on disk is skipped, so an interrupted run just
// resumes. Not wired into the entrypoint: leaving S3 is a deliberate one-off,
// and this needs both stores addressable at once (S3 to read, disk to write).

import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { blobKey, thumbKey } from "@/lib/colosseum/blob";
import { getBytes } from "@/lib/colosseum/storage";
import { db } from "@/lib/db";
import { blobs } from "@/lib/db/schema";

if (!process.env.S3_BUCKET) {
  console.error("export-blobs: S3 is not configured — run this before unsetting S3_BUCKET.");
  process.exit(1);
}

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./data/storage";

const rows = await db.select({ sha256: blobs.sha256 }).from(blobs);

let written = 0;
let missing = 0;
let onDisk = 0;

// ponytail: sequential, like the forward sync — buffering every blob at once
// would spike memory. It's a one-off, so simple beats fast.
for (const { sha256 } of rows) {
  // Thumbnails may not exist in the bucket; getBytes returns null and we skip.
  for (const key of [blobKey(sha256), thumbKey(sha256)]) {
    const dest = path.join(STORAGE_DIR, key);
    if (await stat(dest).catch(() => null)) {
      onDisk += 1;
      continue;
    }
    const bytes = await getBytes(key);
    if (!bytes) {
      missing += 1;
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    // temp + atomic rename so a reader never sees a partial file.
    const tmp = `${dest}.tmp-${randomUUID()}`;
    await writeFile(tmp, bytes);
    await rename(tmp, dest);
    written += 1;
  }
}

console.log(
  `export-blobs: ${written} written, ${onDisk} already on disk, ${missing} not in bucket.`,
);
process.exit(0);
