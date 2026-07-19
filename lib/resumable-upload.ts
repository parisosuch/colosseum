// Client-side driver for resumable video uploads (server: app/api/upload).
//
// A file is sent in fixed chunks the server appends one at a time. The chunk
// offset lives on the server, so a dropped connection or a page refresh resumes
// from the last byte it holds — we don't re-send what already landed.
//
// To survive a hard refresh we stash the actual bytes: the File goes into
// IndexedDB (localStorage can't hold a Blob) alongside its upload id. On mount a
// board calls resumeVideoUploads(), which re-reads IndexedDB, asks the server
// its offset, and continues. The entry is removed once the upload completes.

import type { Column } from "@/lib/colosseum/column";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per PATCH — small enough to retry cheaply.
const DB_NAME = "colosseum-uploads";
const STORE = "pending";

// One in-flight/paused upload, persisted so a refresh can resume it.
type PendingUpload = {
  // channelId:name:size:lastModified — stable across reloads for the same file.
  fingerprint: string;
  id: string;
  channelId: number;
  blob: Blob;
  filename: string;
  mime: string;
  size: number;
};

export type UploadHandlers = {
  // Fired once when an upload begins or resumes, so the UI can show a named row
  // (a resumed upload after a refresh only knows its name from IndexedDB).
  onStart?: (fingerprint: string, filename: string, total: number) => void;
  onProgress?: (fingerprint: string, sent: number, total: number) => void;
  onComplete?: (fingerprint: string, column: Column) => void;
  onError?: (fingerprint: string, message: string) => void;
};

// --- IndexedDB (tiny promise wrapper; no dependency) ------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "fingerprint" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq<T>(store: IDBObjectStore, req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    void store;
  });
}

async function putPending(entry: PendingUpload): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await idbReq(tx.objectStore(STORE), tx.objectStore(STORE).put(entry));
  db.close();
}

async function deletePending(fingerprint: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  await idbReq(tx.objectStore(STORE), tx.objectStore(STORE).delete(fingerprint));
  db.close();
}

async function allPending(): Promise<PendingUpload[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const rows = await idbReq<PendingUpload[]>(
    tx.objectStore(STORE),
    tx.objectStore(STORE).getAll() as IDBRequest<PendingUpload[]>,
  );
  db.close();
  return rows;
}

// --- Upload driver ----------------------------------------------------------

const fingerprintFor = (file: File, channelId: number) =>
  `${channelId}:${file.name}:${file.size}:${file.lastModified}`;

// Push chunks from `startOffset` to the end. Resolves when the upload finishes
// (or rejects if the server rejects it); a network error rejects but leaves the
// IndexedDB entry so it can resume later.
async function pushChunks(
  entry: PendingUpload,
  startOffset: number,
  handlers: UploadHandlers,
): Promise<void> {
  let offset = startOffset;
  while (offset < entry.size) {
    const chunk = entry.blob.slice(offset, offset + CHUNK_SIZE);
    const res = await fetch(`/api/upload/${entry.id}`, {
      method: "PATCH",
      headers: {
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
      },
      body: chunk,
    });

    if (res.status === 409) {
      // Out of sync — the server told us its real offset; jump there.
      offset = (await res.json()).offset;
      continue;
    }
    if (res.status === 404) {
      // The partial expired or was cancelled server-side; stop tracking it.
      await deletePending(entry.fingerprint);
      throw new Error("This upload expired. Please try again.");
    }
    if (!res.ok) {
      throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed.");
    }

    const data = await res.json();
    offset = data.offset;
    handlers.onProgress?.(entry.fingerprint, offset, entry.size);

    if (data.done) {
      await deletePending(entry.fingerprint);
      handlers.onComplete?.(entry.fingerprint, data.column as Column);
      return;
    }
  }
}

// Begin uploading a freshly-picked video. Creates the server session, persists
// the file to IndexedDB (so a refresh can resume), then streams the chunks.
export async function startVideoUpload(
  file: File,
  channelId: number,
  handlers: UploadHandlers,
): Promise<void> {
  const fingerprint = fingerprintFor(file, channelId);
  handlers.onStart?.(fingerprint, file.name, file.size);
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, mime: file.type, size: file.size, filename: file.name }),
    });
    if (!res.ok) {
      throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't start the upload.");
    }
    const { id } = await res.json();
    const entry: PendingUpload = {
      fingerprint,
      id,
      channelId,
      blob: file,
      filename: file.name,
      mime: file.type,
      size: file.size,
    };
    await putPending(entry);
    await pushChunks(entry, 0, handlers);
  } catch (e) {
    handlers.onError?.(fingerprint, e instanceof Error ? e.message : "Upload failed.");
  }
}

// Resume any uploads for `channelId` left pending in IndexedDB (e.g. after a
// refresh). Asks the server its current offset for each and continues from there;
// a server 404 means the partial is gone, so the stale entry is dropped.
export async function resumeVideoUploads(
  channelId: number,
  handlers: UploadHandlers,
): Promise<void> {
  let pending: PendingUpload[];
  try {
    pending = await allPending();
  } catch {
    return; // no IndexedDB (private mode, etc.) — nothing to resume.
  }
  for (const entry of pending.filter((e) => e.channelId === channelId)) {
    try {
      handlers.onStart?.(entry.fingerprint, entry.filename, entry.size);
      const res = await fetch(`/api/upload/${entry.id}`);
      if (res.status === 404) {
        await deletePending(entry.fingerprint);
        continue;
      }
      if (!res.ok) continue;
      const { offset } = await res.json();
      handlers.onProgress?.(entry.fingerprint, offset, entry.size);
      await pushChunks(entry, offset, handlers);
    } catch (e) {
      handlers.onError?.(entry.fingerprint, e instanceof Error ? e.message : "Upload failed.");
    }
  }
}
