// Content-addressed blob storage on local disk. Bytes live at
// <STORAGE_DIR>/<sha[0:2]>/<sha>; metadata lives in the `blobs` table.
// Identical uploads hash to the same path and row, so they dedupe for free.
//
// Blobs are never served by hash. Every stored file is reached through a
// `media` row (one row per reference) whose id is the URL and whose
// `visibility` gates access — served by app/api/media/[id]/route.ts. A blob is
// GC'd only when its last media reference goes away.

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq, inArray, notExists } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/lib/db";
import { blobs, media } from "@/lib/db/schema";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./data/storage";

export type MediaVisibility = "public" | "private";

// Server-side backstop for user uploads (the Supabase bucket used to enforce
// this). Client-side copies of these limits live next to the upload UIs.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
];

export function blobDiskPath(sha256: string): string {
  return path.join(STORAGE_DIR, sha256.slice(0, 2), sha256);
}

// Grid thumbnails render columns a few hundred px wide; 600 covers 2x DPR.
const THUMB_MAX_WIDTH = 600;

// The thumbnail sits next to its source blob. It's derived from the immutable
// blob bytes, so it's content-addressed too and shares the blob's lifetime.
export function thumbDiskPath(sha256: string): string {
  return `${blobDiskPath(sha256)}.thumb`;
}

// Generate (once) a downsized webp thumbnail for a stored image blob and return
// its disk path. Idempotent: an existing thumbnail is returned as-is. Throws if
// the blob isn't a decodable image, so callers fall back to the full bytes.
export async function ensureThumbnail(sha256: string): Promise<string> {
  const dest = thumbDiskPath(sha256);
  if (await stat(dest).catch(() => null)) {
    return dest;
  }
  const tmp = `${dest}.tmp-${randomUUID()}`;
  // `animated: true` reads every frame so an animated GIF/WebP thumbnails to an
  // animated webp instead of a frozen first frame. Harmless for static images
  // (a single page).
  await sharp(blobDiskPath(sha256), { animated: true })
    .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(tmp);
  await rename(tmp, dest);
  return dest;
}

export function mediaUrl(id: string): string {
  return `/api/media/${id}`;
}

// The media id inside a `/api/media/<id>` URL, or null for any other URL
// (block image fields can also hold external URLs).
export function mediaIdFromUrl(url: string): string | null {
  const match =
    /^\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(url);
  return match?.[1] ?? null;
}

// Store bytes + metadata, return the sha256. Safe to call with bytes that are
// already stored: the file is rewritten in place (same content) and the row
// upsert is a no-op.
export async function putBlob(data: Buffer, mime: string, createdBy: string): Promise<string> {
  const sha256 = createHash("sha256").update(data).digest("hex");
  const dest = blobDiskPath(sha256);
  await mkdir(path.dirname(dest), { recursive: true });
  // Write via temp file + atomic rename so a reader (or a concurrent identical
  // upload) never sees a partial file.
  const tmp = `${dest}.tmp-${randomUUID()}`;
  await writeFile(tmp, data);
  await rename(tmp, dest);
  await db
    .insert(blobs)
    .values({ sha256, mime, size: data.length, created_by: createdBy })
    .onConflictDoNothing();
  return sha256;
}

// Create a new reference to stored bytes and return its URL. Visibility lives
// on the reference, never on the blob, so dedup can't leak a private image
// through a public URL for the same bytes.
export async function createMedia(
  sha256: string,
  ownerId: string,
  visibility: MediaVisibility,
): Promise<string> {
  const [row] = await db
    .insert(media)
    .values({ owner_id: ownerId, blob_sha256: sha256, visibility })
    .returning({ id: media.id });
  return mediaUrl(row.id);
}

// Validate + store a user-uploaded image, returning the media URL to persist.
export async function putImageBlob(
  file: File,
  createdBy: string,
  visibility: MediaVisibility,
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Only image files (PNG, JPEG, GIF, WebP, AVIF) are supported.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("That image is too large (max 10MB).");
  }
  const sha256 = await putBlob(Buffer.from(await file.arrayBuffer()), file.type, createdBy);
  return createMedia(sha256, createdBy, visibility);
}

// Everything the serving route needs to authorize and stream one media id.
export async function getMedia(
  id: string,
): Promise<{ owner_id: string; visibility: MediaVisibility; sha256: string; mime: string } | null> {
  const rows = await db
    .select({
      owner_id: media.owner_id,
      visibility: media.visibility,
      sha256: blobs.sha256,
      mime: blobs.mime,
    })
    .from(media)
    .innerJoin(blobs, eq(media.blob_sha256, blobs.sha256))
    .where(eq(media.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// Delete the media reference behind `url` (no-op for non-media URLs), then GC
// the blob if that was its last reference.
export async function deleteMediaByUrl(url: string): Promise<void> {
  const id = mediaIdFromUrl(url);
  if (!id) {
    return;
  }
  const [deleted] = await db
    .delete(media)
    .where(eq(media.id, id))
    .returning({ sha256: media.blob_sha256 });
  if (!deleted) {
    return;
  }
  // Single conditional statement so a still-referenced blob survives. A
  // reference created between the NOT EXISTS check and the delete makes the
  // delete fail on the media FK — also "still referenced", so swallow it.
  const gone = await db
    .delete(blobs)
    .where(
      and(
        eq(blobs.sha256, deleted.sha256),
        notExists(db.select().from(media).where(eq(media.blob_sha256, deleted.sha256))),
      ),
    )
    .returning({ sha256: blobs.sha256 })
    .catch(() => []);
  if (gone.length > 0) {
    await unlink(blobDiskPath(deleted.sha256)).catch(() => {});
    await unlink(thumbDiskPath(deleted.sha256)).catch(() => {});
  }
}

// Retarget the visibility of every media URL in `urls`; non-media URLs are
// ignored. Used when a channel flips public/private.
export async function setMediaVisibilityByUrls(
  urls: string[],
  visibility: MediaVisibility,
): Promise<void> {
  const ids = urls.map(mediaIdFromUrl).filter((id): id is string => id !== null);
  if (ids.length > 0) {
    await db.update(media).set({ visibility }).where(inArray(media.id, ids));
  }
}
