// Resumable chunked uploads for large files (video). The transfer is split into
// chunks the client PATCHes one at a time, so a dropped connection or a page
// refresh resumes from the last byte the server has instead of restarting.
//
// A partial upload is an append-only file at <STORAGE_DIR>/uploads/<id>, with a
// sidecar <id>.json holding who/what/where so each chunk can be authorized and
// the finished file turned into a blob. Once complete, the bytes are handed to
// the content-addressed blob store (see blob.ts) and the partial is removed.

import "server-only";

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./data/storage";
const UPLOAD_DIR = path.join(STORAGE_DIR, "uploads");

// An abandoned partial (tab closed mid-upload, never resumed) is swept after
// this long. Chosen so a user can reasonably come back the next day and resume.
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

export type UploadMeta = {
  ownerId: string;
  channelId: number;
  mime: string;
  // Total expected bytes, declared at create — the append guard rejects going
  // past it, and completion is offset === size.
  size: number;
  filename: string;
  // Epoch ms; drives GC of abandoned partials.
  createdAt: number;
};

const partPath = (id: string) => path.join(UPLOAD_DIR, id);
const metaPath = (id: string) => path.join(UPLOAD_DIR, `${id}.json`);

// Reject an id that isn't one we minted, so a crafted id can't escape UPLOAD_DIR.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isValidUploadId(id: string): boolean {
  return UUID_RE.test(id);
}

// Start a partial: an empty file + its sidecar meta. Returns the upload id.
export async function createUpload(meta: UploadMeta): Promise<string> {
  const id = randomUUID();
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(partPath(id), Buffer.alloc(0));
  await writeFile(metaPath(id), JSON.stringify(meta));
  return id;
}

export async function getUploadMeta(id: string): Promise<UploadMeta | null> {
  if (!isValidUploadId(id)) return null;
  try {
    return JSON.parse(await readFile(metaPath(id), "utf8")) as UploadMeta;
  } catch {
    return null;
  }
}

// Bytes the server already holds — the resume point.
export async function getUploadOffset(id: string): Promise<number> {
  const s = await stat(partPath(id)).catch(() => null);
  return s ? s.size : 0;
}

export type AppendResult = { ok: true; offset: number } | { ok: false; offset: number };

// Append one chunk at `offset`. The offset must equal what the server already
// has (else the client is out of sync — return the real offset so it resyncs),
// and the total can't exceed the declared size. Returns the new offset.
export async function appendUploadChunk(
  id: string,
  offset: number,
  bytes: Buffer,
  meta: UploadMeta,
): Promise<AppendResult> {
  const current = await getUploadOffset(id);
  if (offset !== current) {
    return { ok: false, offset: current };
  }
  if (current + bytes.length > meta.size) {
    throw new Error("Upload exceeds its declared size.");
  }
  await appendFile(partPath(id), bytes);
  return { ok: true, offset: current + bytes.length };
}

// Read the fully-assembled partial back for handoff to the blob store.
export async function readAssembledUpload(id: string): Promise<Buffer> {
  return readFile(partPath(id));
}

// Drop a partial and its sidecar (completed, cancelled, or GC'd).
export async function cleanupUpload(id: string): Promise<void> {
  if (!isValidUploadId(id)) return;
  await unlink(partPath(id)).catch(() => {});
  await unlink(metaPath(id)).catch(() => {});
}

// Remove partials whose meta is older than STALE_UPLOAD_MS. Called opportunistically
// on create, so abandoned uploads don't accumulate on disk. `now` is injectable
// for tests.
export async function sweepStaleUploads(now = Date.now()): Promise<void> {
  const entries = await readdir(UPLOAD_DIR).catch(() => [] as string[]);
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    const meta = await getUploadMeta(id);
    if (meta && now - meta.createdAt > STALE_UPLOAD_MS) {
      await cleanupUpload(id);
    }
  }
}
