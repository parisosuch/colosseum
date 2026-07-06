import { expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { blobDiskPath, ensureThumbnail, thumbDiskPath } from "./blob";

// ensureThumbnail only touches disk (no DB), so a fake sha used purely as a
// path key is enough. Write a wide source image, thumbnail it, assert the
// output is a downsized webp — and that a second call reuses it.
test("ensureThumbnail downsizes an image to a cached webp", async () => {
  const sha = `test${"0".repeat(60)}`;
  const src = blobDiskPath(sha);
  await mkdir(path.dirname(src), { recursive: true });
  const big = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await writeFile(src, big);

  try {
    const thumb = await ensureThumbnail(sha);
    expect(thumb).toBe(thumbDiskPath(sha));
    const meta = await sharp(await readFile(thumb)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(600);

    // Idempotent: source gone, but the cached thumbnail is returned as-is.
    await rm(src);
    expect(await ensureThumbnail(sha)).toBe(thumb);
  } finally {
    await rm(src).catch(() => {});
    await rm(thumbDiskPath(sha)).catch(() => {});
  }
});
