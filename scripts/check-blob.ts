// Minimal self-check for the blob store: put → file on disk + blobs row,
// identical put dedupes to the same sha/path. Needs the local DB running:
//   bun --conditions=react-server scripts/check-blob.ts

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sep } from "node:path";

import { blobDiskPath, blobUrl, putBlob } from "@/lib/colosseum/blob";
import { getBlobMeta } from "@/lib/colosseum/blob";

const data = Buffer.from(`check-blob ${Date.now()}`);
const userId = "00000000-0000-0000-0000-000000000000";

const sha = await putBlob(data, "text/plain", userId);
const expected = createHash("sha256").update(data).digest("hex");

if (sha !== expected) throw new Error(`sha mismatch: ${sha} != ${expected}`);
if (!blobDiskPath(sha).endsWith(`${sha.slice(0, 2)}${sep}${sha}`)) {
  throw new Error(`bad disk path: ${blobDiskPath(sha)}`);
}
if (blobUrl(sha) !== `/api/blob/${sha}`) throw new Error(`bad url: ${blobUrl(sha)}`);
if (!(await readFile(blobDiskPath(sha))).equals(data)) throw new Error("disk bytes differ");

const meta = await getBlobMeta(sha);
if (meta?.mime !== "text/plain" || meta?.size !== data.length) {
  throw new Error(`bad row: ${JSON.stringify(meta)}`);
}

// Identical bytes dedupe: same sha, and the second put must not throw.
const again = await putBlob(data, "text/plain", userId);
if (again !== sha) throw new Error("dedupe failed");

console.log(`ok: ${blobUrl(sha)}`);
process.exit(0);
