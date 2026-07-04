import puppeteer from "puppeteer";
import sharp from "sharp";

export interface Screenshot {
  id: number;
  created_at: string;
  url: string;
  image_url: string;
  title: string;
}

/** Side length of the square screenshot, in pixels. */
export const SCREENSHOT_SIZE = 1200;

/**
 * Capture a square PNG of the top of a web page.
 *
 * Used by `app/api/screenshot/route.ts`. Requires a launchable Chromium; in
 * minimal Linux/WSL environments the Chromium system libraries must be
 * installed first (see the README).
 */
export async function captureWebsiteScreenshot(
  url: string,
): Promise<{ image: Buffer; title: string; description: string }> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: SCREENSHOT_SIZE, height: SCREENSHOT_SIZE });
    await page.goto(url, { waitUntil: "networkidle2" });

    // Pull the page's own metadata so a captured URL block can pre-fill its
    // title and description. Prefer Open Graph, fall back to <title> / the
    // standard meta description. Capped so an overlong tag can't bloat a block.
    const meta = await page.evaluate(() => {
      const content = (selector: string) =>
        document.querySelector(selector)?.getAttribute("content")?.trim() ?? "";
      return {
        ogTitle: content('meta[property="og:title"]'),
        ogDescription: content('meta[property="og:description"]'),
        metaDescription: content('meta[name="description"]'),
        docTitle: document.title.trim(),
      };
    });
    const title = (meta.ogTitle || meta.docTitle).slice(0, 200);
    const description = (meta.ogDescription || meta.metaDescription).slice(0, 500);

    // Full-page screenshot, then crop to the top square.
    const buffer = (await page.screenshot({ fullPage: true })) as Buffer;

    const image = await sharp(buffer)
      .extract({
        left: 0,
        top: 0,
        width: SCREENSHOT_SIZE,
        height: SCREENSHOT_SIZE,
      })
      .toFormat("png")
      .toBuffer();

    return { image, title, description };
  } finally {
    await browser.close();
  }
}
