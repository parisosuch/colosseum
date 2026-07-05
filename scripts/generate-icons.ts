// Regenerate the PWA / home-screen icons from the logo. Run after the logo
// changes: bun scripts/generate-icons.ts
//
// Source is the logo mark (app/icon.svg), a black mark on transparency.
// Icons are composited onto an opaque white square — iOS shows apple-touch-icon
// as-is and renders transparency as black, so an opaque background is required.

import path from "node:path";

import sharp from "sharp";

const SRC = path.join("app", "icon.svg");
// Rasterize the vector at high resolution so even the 512px icons stay crisp.
const DENSITY = 512;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// size: output square px. logoRatio: fraction of the square the logo spans.
// Maskable icons need a larger margin so the mark survives a circular crop.
const ICONS: { out: string; size: number; logoRatio: number }[] = [
  { out: "apple-touch-icon.png", size: 180, logoRatio: 0.8 },
  { out: "icon-192.png", size: 192, logoRatio: 0.8 },
  { out: "icon-512.png", size: 512, logoRatio: 0.8 },
  { out: "icon-maskable-512.png", size: 512, logoRatio: 0.6 },
];

for (const { out, size, logoRatio } of ICONS) {
  const inner = Math.round(size * logoRatio);
  const logo = await sharp(SRC, { density: DENSITY })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join("public", out));
  console.log(`wrote public/${out} (${size}x${size})`);
}
