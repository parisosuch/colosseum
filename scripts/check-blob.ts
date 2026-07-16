// Minimal self-check for the blob + media layer: put → object in storage +
// blobs row, identical put dedupes, media references gate the blob's lifetime
// (GC only when the last reference goes). Runs against the default local
// backend. Needs the local DB running:
//   bun --conditions=react-server scripts/check-blob.ts

import { createHash } from "node:crypto";

import {
  blobKey,
  createMedia,
  deleteMediaByUrl,
  getMedia,
  mediaIdFromUrl,
  putBlob,
} from "@/lib/colosseum/blob";
import { getBytes, objectExists } from "@/lib/colosseum/storage";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";

const data = Buffer.from(`check-blob ${Date.now()}`);
const userId = "00000000-0000-0000-0000-000000000000";

// The FKs (blobs.created_by, media.owner_id) need a real user row.
await db
  .insert(user)
  .values({ id: userId, name: "check-blob", email: "check-blob@example.invalid" })
  .onConflictDoNothing();

const sha = await putBlob(data, "text/plain", userId);
const expected = createHash("sha256").update(data).digest("hex");

if (sha !== expected) throw new Error(`sha mismatch: ${sha} != ${expected}`);
if (blobKey(sha) !== `${sha.slice(0, 2)}/${sha}`) {
  throw new Error(`bad blob key: ${blobKey(sha)}`);
}
const stored = await getBytes(blobKey(sha));
if (!stored?.equals(data)) throw new Error("stored bytes differ");

// Identical bytes dedupe: same sha, and the second put must not throw.
const again = await putBlob(data, "text/plain", userId);
if (again !== sha) throw new Error("dedupe failed");

// Two references to the same blob, one private and one public — visibility
// lives on the reference, so both must coexist and resolve independently.
const privateUrl = await createMedia(sha, userId, "private");
const publicUrl = await createMedia(sha, userId, "public");
const privateId = mediaIdFromUrl(privateUrl);
const publicId = mediaIdFromUrl(publicUrl);
if (!privateId || !publicId) throw new Error(`bad media urls: ${privateUrl}, ${publicUrl}`);

const priv = await getMedia(privateId);
if (priv?.visibility !== "private" || priv.sha256 !== sha || priv.mime !== "text/plain") {
  throw new Error(`bad private media: ${JSON.stringify(priv)}`);
}
const pub = await getMedia(publicId);
if (pub?.visibility !== "public") throw new Error(`bad public media: ${JSON.stringify(pub)}`);

// Dropping one reference must keep the blob; dropping the last one GCs it.
await deleteMediaByUrl(privateUrl);
if (!(await getMedia(publicId))) throw new Error("surviving reference lost");
if (!(await objectExists(blobKey(sha)))) throw new Error("still-referenced blob deleted");
await deleteMediaByUrl(publicUrl);
if (await getMedia(publicId)) throw new Error("deleted reference still resolves");
if (await objectExists(blobKey(sha))) throw new Error("blob object not GC'd");

// Deleting a non-media URL is a no-op, not an error.
await deleteMediaByUrl("https://example.com/image.png");

console.log(`ok: ${publicUrl}`);
process.exit(0);
