// Content-addressed blob storage. Bytes live in a pluggable object store
// (local disk or S3-compatible, see ./storage) keyed by sha; metadata lives in
// the `blobs` table. Identical uploads hash to the same key and row, so they
// dedupe for free.
//
// Blobs are never served by hash. Every stored file is reached through a
// `media` row (one row per reference) whose id is the URL and whose
// `visibility` gates access — served by app/api/media/[id]/route.ts. A blob is
// GC'd only when its last media reference goes away.

import "server-only";

import { createHash } from "node:crypto";

import { and, eq, inArray, notExists } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/lib/db";
import { blobs, media } from "@/lib/db/schema";
import { DESKTOP_UA } from "./og-meta";
import { deleteObject, getBytes, objectExists, putObject } from "./storage";

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

// Storage keys are content-addressed: identical bytes hash to the same key and
// dedupe for free. `<sha[0:2]>/<sha>` shards the top level so no directory (or
// bucket listing) holds every blob at once.
export function blobKey(sha256: string): string {
  return `${sha256.slice(0, 2)}/${sha256}`;
}

// Grid thumbnails render columns a few hundred px wide; 600 covers 2x DPR.
const THUMB_MAX_WIDTH = 600;

// The thumbnail derives from the immutable blob bytes, so it's content-addressed
// too and shares the blob's lifetime.
export function thumbKey(sha256: string): string {
  return `${blobKey(sha256)}.thumb`;
}

// Generate (once) a downsized webp thumbnail for a stored image blob and return
// its storage key. Idempotent: an existing thumbnail is left as-is. Throws if
// the blob isn't a decodable image, so callers fall back to the full bytes.
export async function ensureThumbnail(sha256: string): Promise<string> {
  const key = thumbKey(sha256);
  if (await objectExists(key)) {
    return key;
  }
  const src = await getBytes(blobKey(sha256));
  if (!src) {
    throw new Error(`blob ${sha256} not found`);
  }
  // `animated: true` reads every frame so an animated GIF/WebP thumbnails to an
  // animated webp instead of a frozen first frame. Harmless for static images
  // (a single page).
  const out = await sharp(src, { animated: true })
    .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
  await putObject(key, out, "image/webp");
  return key;
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
  await putObject(blobKey(sha256), data, mime);
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
  // Pre-build the thumbnail so the first grid render serves it already made,
  // instead of paying the sharp resize on the first `?thumb` request. Idempotent
  // and dedup-friendly (ensureThumbnail skips if the file already exists). A
  // failure here just falls back to the lazy path in the serving route, so it
  // must never fail the upload.
  await ensureThumbnail(sha256).catch(() => {});
  return createMedia(sha256, createdBy, visibility);
}

// Fetch a remote image URL and store its bytes as a blob (like a web upload),
// returning the media URL. So an image supplied as a URL — the web paste-from-URL
// flow and the API's image-block create — is ingested and thumbnailed instead of
// persisting a third-party URL that skips compression and pins us to their host.
// Throws on a bad/unreachable/oversized/non-image URL; putImageBlob re-validates
// type and size. ponytail: no SSRF allowlist, matching the screenshot capture's
// existing posture — tighten both together if the threat model changes.
export async function putImageBlobFromUrl(
  imageUrl: string,
  createdBy: string,
  visibility: MediaVisibility,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new Error("Bad image URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported image URL.");
  }
  const res = await fetch(url, { headers: { "User-Agent": DESKTOP_UA, Accept: "image/*" } });
  if (!res.ok) {
    throw new Error("Couldn't fetch that image.");
  }
  if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    throw new Error("That image is too large (max 10MB).");
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const file = new File([await res.arrayBuffer()], "remote-image", { type });
  return putImageBlob(file, createdBy, visibility);
}

// PDFs are heavier than images and aren't downsized, so a roomier cap.
export const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB

// Validate + store a user-uploaded PDF, returning the media URL to persist. No
// thumbnail (sharp can't rasterize a PDF); the block renders a placeholder in
// the grid and the real file in an <iframe> in the modal.
export async function putPdfBlob(
  file: File,
  createdBy: string,
  visibility: MediaVisibility,
): Promise<string> {
  if (file.type !== "application/pdf") {
    throw new Error("Only PDF files are supported.");
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error("That PDF is too large (max 25MB).");
  }
  const sha256 = await putBlob(Buffer.from(await file.arrayBuffer()), file.type, createdBy);
  return createMedia(sha256, createdBy, visibility);
}

// Videos are the heaviest upload, so the roomiest cap. Served through the same
// /api/media route, which honors Range requests so playback can seek.
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];

// Validate + store a user-uploaded video, returning the media URL to persist.
// No thumbnail (sharp can't rasterize a video); the block renders the video
// element itself, which shows its first frame in the grid.
export async function putVideoBlob(
  file: File,
  createdBy: string,
  visibility: MediaVisibility,
): Promise<string> {
  if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
    throw new Error("Only video files (MP4, WebM, MOV, OGG) are supported.");
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error("That video is too large (max 100MB).");
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
    await deleteObject(blobKey(deleted.sha256));
    await deleteObject(thumbKey(deleted.sha256));
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
