// Pluggable object store behind the blob layer (lib/colosseum/blob.ts). Two
// backends, picked once at import from env:
//
//   - local disk (default) — bytes at <STORAGE_DIR>/<key>. Self-hosted default,
//     no config needed. Served by streaming through /api/media.
//   - S3-compatible (AWS S3, Cloudflare R2, …) — enabled by setting S3_BUCKET.
//     Keeps the app off the byte path: public blobs redirect to a CDN (CDN_URL)
//     or the store; private blobs redirect to a short-lived signed URL minted
//     only after the serving route authorizes the request.
//
// Keys are opaque strings the caller derives from a blob's sha (see blob.ts);
// this module never interprets them. `putObject` takes bytes; `getObject`
// streams for serving; `getBytes` buffers for re-processing (thumbnails).
//
// ponytail: no STORAGE_BACKEND toggle — the presence of S3_BUCKET fully
// determines the backend, so a second switch would just be a way to
// misconfigure it. Add one only if a backend needs selecting without its creds.

import "server-only";

import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";

import { AwsClient } from "aws4fetch";

export type StoredObject = { body: ReadableStream; size: number };

interface Backend {
  putObject(key: string, data: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<StoredObject | null>;
  getBytes(key: string): Promise<Buffer | null>;
  objectExists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
  // A directly-fetchable URL for `key` (CDN/edge), or null when the object can
  // only be reached by streaming through the app. Only ever used for public
  // blobs — private ones always stream or use a signed URL so access stays
  // authorized.
  publicUrl(key: string): string | null;
  // A short-lived signed URL for `key`, safe to hand a client for a private
  // blob (the signature is the capability, so no bucket ACL needed), or null
  // when the backend can't sign (local disk → the app streams instead).
  signedUrl(key: string): Promise<string | null>;
}

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./data/storage";

const localBackend: Backend = {
  async putObject(key, data) {
    const dest = path.join(STORAGE_DIR, key);
    await mkdir(path.dirname(dest), { recursive: true });
    // temp + atomic rename so a reader never sees a partial file.
    const tmp = `${dest}.tmp-${randomUUID()}`;
    await writeFile(tmp, data);
    await rename(tmp, dest);
  },
  async getObject(key) {
    const dest = path.join(STORAGE_DIR, key);
    const s = await stat(dest).catch(() => null);
    if (!s) {
      return null;
    }
    // Node's web-stream type doesn't structurally match the DOM lib's; at
    // runtime they're the same thing.
    return {
      body: Readable.toWeb(createReadStream(dest)) as unknown as ReadableStream,
      size: s.size,
    };
  },
  getBytes(key) {
    return readFile(path.join(STORAGE_DIR, key)).catch(() => null);
  },
  async objectExists(key) {
    return (await stat(path.join(STORAGE_DIR, key)).catch(() => null)) !== null;
  },
  async deleteObject(key) {
    await unlink(path.join(STORAGE_DIR, key)).catch(() => {});
  },
  publicUrl() {
    return null;
  },
  async signedUrl() {
    return null;
  },
};

function s3Backend(): Backend {
  const bucket = process.env.S3_BUCKET!;
  const region = process.env.S3_REGION ?? "us-east-1";
  const cdn = process.env.CDN_URL?.replace(/\/$/, "");
  // For AWS, the virtual-hosted bucket URL is derivable; for R2/MinIO/etc. set
  // S3_ENDPOINT to the bucket's base URL (e.g. https://<acct>.r2.cloudflarestorage.com/<bucket>).
  const base = (process.env.S3_ENDPOINT ?? `https://${bucket}.s3.${region}.amazonaws.com`).replace(
    /\/$/,
    "",
  );
  const aws = new AwsClient({
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    region,
    service: "s3",
  });
  const url = (key: string) => `${base}/${encodeURI(key)}`;

  return {
    async putObject(key, data, contentType) {
      const res = await aws.fetch(url(key), {
        method: "PUT",
        body: new Uint8Array(data),
        headers: { "Content-Type": contentType },
      });
      if (!res.ok) {
        throw new Error(`S3 put ${key} failed: ${res.status}`);
      }
    },
    async getObject(key) {
      const res = await aws.fetch(url(key));
      if (!res.ok || !res.body) {
        return null;
      }
      return { body: res.body, size: Number(res.headers.get("content-length")) };
    },
    async getBytes(key) {
      const res = await aws.fetch(url(key));
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    },
    async objectExists(key) {
      const res = await aws.fetch(url(key), { method: "HEAD" });
      return res.ok;
    },
    async deleteObject(key) {
      await aws.fetch(url(key), { method: "DELETE" }).catch(() => {});
    },
    publicUrl(key) {
      return cdn ? `${cdn}/${encodeURI(key)}` : null;
    },
    async signedUrl(key) {
      // Presign a GET against the store endpoint (signQuery moves the SigV4
      // signature into the query string). Signed for the bucket host, so this
      // points at the object store's edge, not CDN_URL. TTL bounds the leak.
      const u = new URL(url(key));
      u.searchParams.set("X-Amz-Expires", "3600");
      const signed = await aws.sign(u.toString(), { method: "GET", aws: { signQuery: true } });
      return signed.url;
    },
  };
}

const backend: Backend = process.env.S3_BUCKET ? s3Backend() : localBackend;

export const putObject = backend.putObject;
export const getObject = backend.getObject;
export const getBytes = backend.getBytes;
export const objectExists = backend.objectExists;
export const deleteObject = backend.deleteObject;
export const publicUrl = backend.publicUrl;
export const signedUrl = backend.signedUrl;
