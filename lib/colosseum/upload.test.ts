import { expect, test } from "bun:test";

import {
  appendUploadChunk,
  cleanupUpload,
  createUpload,
  getUploadMeta,
  getUploadOffset,
  isValidUploadId,
  readAssembledUpload,
  sweepStaleUploads,
  type UploadMeta,
} from "./upload";

const meta = (size: number, createdAt = 1_000_000_000_000): UploadMeta => ({
  ownerId: "u1",
  channelId: 1,
  mime: "video/mp4",
  size,
  filename: "v.mp4",
  createdAt,
});

test("chunks append in order and reassemble to the original bytes", async () => {
  const data = Buffer.from("the quick brown fox jumps over the lazy dog");
  const id = await createUpload(meta(data.length));
  expect(isValidUploadId(id)).toBe(true);
  expect(await getUploadOffset(id)).toBe(0);

  expect(await appendUploadChunk(id, 0, data.subarray(0, 10), meta(data.length))).toEqual({
    ok: true,
    offset: 10,
  });
  expect(await appendUploadChunk(id, 10, data.subarray(10, 25), meta(data.length))).toEqual({
    ok: true,
    offset: 25,
  });
  const last = await appendUploadChunk(id, 25, data.subarray(25), meta(data.length));
  expect(last).toEqual({ ok: true, offset: data.length });

  expect(Buffer.compare(await readAssembledUpload(id), data)).toBe(0);

  await cleanupUpload(id);
  expect(await getUploadMeta(id)).toBeNull();
});

test("a wrong offset is rejected with the real offset (resync), not appended", async () => {
  const data = Buffer.from("0123456789");
  const id = await createUpload(meta(data.length));
  await appendUploadChunk(id, 0, data.subarray(0, 4), meta(data.length)); // offset → 4

  const bad = await appendUploadChunk(id, 0, data.subarray(4), meta(data.length)); // stale offset
  expect(bad).toEqual({ ok: false, offset: 4 });
  expect(await getUploadOffset(id)).toBe(4); // nothing appended

  await cleanupUpload(id);
});

test("appending past the declared size throws (never overflows the file)", async () => {
  const id = await createUpload(meta(3));
  expect(appendUploadChunk(id, 0, Buffer.from("toolong"), meta(3))).rejects.toThrow();
  expect(await getUploadOffset(id)).toBe(0);
  await cleanupUpload(id);
});

test("isValidUploadId rejects path-traversal ids", () => {
  expect(isValidUploadId("../../etc/passwd")).toBe(false);
  expect(isValidUploadId("not-a-uuid")).toBe(false);
});

test("sweepStaleUploads removes old partials, keeps fresh ones", async () => {
  const old = await createUpload(meta(10, 0));
  const fresh = await createUpload(meta(10, 1_000_000_000_000));
  // now just after the fresh one: old (createdAt 0) is well past the 24h window.
  await sweepStaleUploads(1_000_000_000_000 + 1000);
  expect(await getUploadMeta(old)).toBeNull();
  expect(await getUploadMeta(fresh)).not.toBeNull();
  await cleanupUpload(fresh);
});
