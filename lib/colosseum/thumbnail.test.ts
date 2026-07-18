import { expect, test } from "bun:test";

import sharp from "sharp";

import { blobKey, ensureThumbnail, thumbKey } from "./blob";
import { deleteObject, getBytes, putObject } from "./storage";

// ensureThumbnail only touches the object store (no DB), so a fake sha used
// purely as a key is enough. Store a wide source image, thumbnail it, assert
// the output is a downsized webp — and that a second call reuses it.
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
