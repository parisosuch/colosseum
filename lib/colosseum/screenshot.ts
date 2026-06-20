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
 * Shared by `app/api/screenshot/route.ts` (runtime screenshots) and
 * `scripts/generate-seed-screenshots.ts` (seed data) so both produce identical
 * images. Requires a launchable Chromium; in minimal Linux/WSL environments the
 * Chromium system libraries must be installed first (see the README).
 */
export async function captureWebsiteScreenshot(
  url: string,
): Promise<{ image: Buffer; title: string }> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: SCREENSHOT_SIZE, height: SCREENSHOT_SIZE });
    await page.goto(url, { waitUntil: "networkidle2" });

    const title = await page.title();

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

    return { image, title };
  } finally {
    await browser.close();
  }
}
