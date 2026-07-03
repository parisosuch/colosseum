// Content-addressed blob storage on local disk. Bytes live at
// <STORAGE_DIR>/<sha[0:2]>/<sha>; metadata lives in the `blobs` table.
// Identical uploads hash to the same path and row, so they dedupe for free.
// Served by app/api/blob/[sha]/route.ts.
//
// ponytail: one concrete local-disk store, no driver abstraction. Add an S3
// driver behind these same functions if the app ever outgrows one disk.

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { blobs } from "@/lib/db/schema";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./data/storage";

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

export function blobUrl(sha256: string): string {
  return `/api/blob/${sha256}`;
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

// Validate + store a user-uploaded image, returning the URL to persist.
export async function putImageBlob(file: File, createdBy: string): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Only image files (PNG, JPEG, GIF, WebP, AVIF) are supported.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("That image is too large (max 10MB).");
  }
  const sha256 = await putBlob(Buffer.from(await file.arrayBuffer()), file.type, createdBy);
  return blobUrl(sha256);
}

export async function getBlobMeta(sha256: string): Promise<{ mime: string; size: number } | null> {
  const rows = await db
    .select({ mime: blobs.mime, size: blobs.size })
    .from(blobs)
    .where(eq(blobs.sha256, sha256))
    .limit(1);
  return rows[0] ?? null;
}
