import { beforeAll, expect, test } from "bun:test";

import sharp from "sharp";

import { seed, USERS } from "@/scripts/seed";
import {
  blobKey,
  createMedia,
  ensureThumbnail,
  getMedia,
  mediaIdFromUrl,
  putBlob,
  thumbKey,
} from "./blob";
import { deleteObject, getBytes, putObject } from "./storage";

beforeAll(async () => {
  await seed();
});

// The marking below is best-effort, so a sha with no blobs row updates nothing
// and doesn't throw — which is why these two can still use a fake sha as a key.
// Store a wide source image, thumbnail it, assert the output is a downsized
// webp — and that a second call reuses it.
test("ensureThumbnail downsizes an image to a cached webp", async () => {
  const sha = `test${"0".repeat(60)}`;
  const big = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await putObject(blobKey(sha), big, "image/png");

  try {
    const thumb = await ensureThumbnail(sha);
    expect(thumb).toBe(thumbKey(sha));
    const meta = await sharp((await getBytes(thumb))!).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(600);

    // Idempotent: source gone, but the cached thumbnail is returned as-is.
    await deleteObject(blobKey(sha));
    expect(await ensureThumbnail(sha)).toBe(thumb);
  } finally {
    await deleteObject(blobKey(sha));
    await deleteObject(thumbKey(sha));
  }
});

// An animated source must keep its frames — the thumbnail should be an animated
// webp, not a frozen first frame.
test("ensureThumbnail preserves animation frames", async () => {
  const sha = `test${"1".repeat(60)}`;
  // A 3-frame animated gif, built by joining three solid frames.
  const frame = (background: { r: number; g: number; b: number; alpha: number }) =>
    sharp({ create: { width: 800, height: 400, channels: 4, background } })
      .png()
      .toBuffer();
  const frames = await Promise.all([
    frame({ r: 255, g: 0, b: 0, alpha: 1 }),
    frame({ r: 0, g: 255, b: 0, alpha: 1 }),
    frame({ r: 0, g: 0, b: 255, alpha: 1 }),
  ]);
  const gif = await sharp(frames, { join: { animated: true } })
    .gif({ loop: 0 })
    .toBuffer();
  await putObject(blobKey(sha), gif, "image/gif");

  try {
    const thumb = await ensureThumbnail(sha);
    const meta = await sharp((await getBytes(thumb))!, { animated: true }).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.pages).toBe(3);
  } finally {
    await deleteObject(blobKey(sha));
    await deleteObject(thumbKey(sha));
  }
});

// The serving route reads `has_thumbnail` to decide whether it can go straight
// to the thumb key or has to probe storage first, so generating a thumbnail has
// to leave that mark behind — on a real blob row, unlike the tests above.
test("ensureThumbnail marks the blob row so the serving route can skip the probe", async () => {
  const png = await sharp({
    create: { width: 1200, height: 600, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const sha = await putBlob(png, "image/png", USERS.alice.id);
  const url = await createMedia(sha, USERS.alice.id, "public");
  const id = mediaIdFromUrl(url)!;

  try {
    // putBlob stores bytes only — nothing has thumbnailed them yet.
    expect((await getMedia(id))!.has_thumbnail).toBe(false);

    await ensureThumbnail(sha);
    expect((await getMedia(id))!.has_thumbnail).toBe(true);
  } finally {
    await deleteObject(blobKey(sha));
    await deleteObject(thumbKey(sha));
  }
});

// A blob thumbnailed before the column existed has the object but a false row.
// The lazy path has to notice and record it, or every `?thumb` for that blob
// keeps paying the probe forever.
test("ensureThumbnail marks a blob whose thumbnail was already stored", async () => {
  const png = await sharp({
    create: { width: 900, height: 300, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const sha = await putBlob(png, "image/png", USERS.alice.id);
  const url = await createMedia(sha, USERS.alice.id, "public");
  const id = mediaIdFromUrl(url)!;

  // Put the thumbnail there directly, leaving the row saying otherwise.
  await putObject(thumbKey(sha), Buffer.from("pretend-webp"), "image/webp");
  expect((await getMedia(id))!.has_thumbnail).toBe(false);

  try {
    // Returns the existing key without regenerating, and records what it found.
    expect(await ensureThumbnail(sha)).toBe(thumbKey(sha));
    expect((await getMedia(id))!.has_thumbnail).toBe(true);
    expect(await getBytes(thumbKey(sha))).toEqual(Buffer.from("pretend-webp"));
  } finally {
    await deleteObject(blobKey(sha));
    await deleteObject(thumbKey(sha));
  }
});
