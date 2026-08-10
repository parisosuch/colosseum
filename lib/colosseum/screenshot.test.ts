import { afterAll, beforeAll, expect, test } from "bun:test";
import sharp from "sharp";

import { seed, USERS } from "@/scripts/seed";
import { getMedia, mediaIdFromUrl, blobKey } from "./blob";
import { createChannel } from "./channel";
import { getChannelColumns, uploadURLColumn } from "./column";
import { captureAndCacheScreenshot } from "./screenshot";
import { getScreenshot } from "./screenshot-data";
import { getBytes } from "./storage";

// A distinctive solid colour: finding it in the stored preview is what proves
// the og:image was used. A live render of the same page would be a white page
// with the word "page" on it, so the two are never confusable — and the render
// path needs a Chromium, which this test must never reach.
const OG_RGB = { r: 200, g: 40, b: 90 };

// 1200x630, the 1.91:1 shape sites actually publish, so this also covers the
// squaring that the store expects.
let ogImage: Buffer;
let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(async () => {
  await seed();
  ogImage = await sharp({
    create: { width: 1200, height: 630, channels: 3, background: OG_RGB },
  })
    .png()
    .toBuffer();

  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/img.png") {
        return new Response(new Uint8Array(ogImage), {
          headers: { "Content-Type": "image/png" },
        });
      }
      return new Response(
        `<html><head>
           <meta property="og:image" content="/img.png">
           <meta property="og:title" content="Quokka Weekly">
           <meta property="og:description" content="A newsletter about quokkas.">
           <title>only used when og:title is absent</title>
         </head><body>page</body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

async function storedPreview(url: string): Promise<Buffer> {
  const row = await getScreenshot(url);
  const id = row?.image_url ? mediaIdFromUrl(row.image_url) : null;
  const media = id ? await getMedia(id) : null;
  const bytes = media ? await getBytes(blobKey(media.sha256)) : null;
  if (!bytes) throw new Error(`no stored preview for ${url}`);
  return bytes;
}

test("a URL block's preview comes from og:image, and names the blocks pointing at it", async () => {
  const url = `${base}/page`;
  const channel = await createChannel({
    title: "OG previews",
    access: "public",
    owner_id: USERS.alice.id,
  });
  // The block exists before the capture runs, created with nothing but a link —
  // the real ordering, and the reason the naming has to happen afterwards.
  const block = await uploadURLColumn({
    created_by: USERS.alice.id,
    channel_id: channel.id,
    text: url,
  });
  expect(block.title).toBeUndefined();

  const result = await captureAndCacheScreenshot(url, USERS.alice.id);
  expect(result.title).toBe("Quokka Weekly");
  expect(result.description).toBe("A newsletter about quokkas.");

  // Squared to what the store expects, from a 1.91:1 source.
  const preview = await storedPreview(url);
  const meta = await sharp(preview).metadata();
  expect(meta.width).toBe(1200);
  expect(meta.height).toBe(1200);

  // The centre pixel is the og:image's colour, so these bytes came from the
  // published preview rather than from rendering the page.
  const { data } = await sharp(preview)
    .extract({ left: 600, top: 600, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([data[0], data[1], data[2]]).toEqual([OG_RGB.r, OG_RGB.g, OG_RGB.b]);

  // And the block that was created blank now carries the page's own name, which
  // is what makes it findable.
  const named = (await getChannelColumns(channel.id)).find((c) => c.id === block.id);
  expect(named?.title).toBe("Quokka Weekly");
  expect(named?.description).toBe("A newsletter about quokkas.");
});
