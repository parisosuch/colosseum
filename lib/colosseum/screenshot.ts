import puppeteer, { TimeoutError } from "puppeteer";
import sharp from "sharp";

import { createMedia, putBlob } from "./blob";
import { getScreenshot, upsertScreenshot, ScreenshotRow } from "./screenshot-data";
import { logError, logInfo } from "@/lib/log";

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
    try {
      await page.goto(url, { waitUntil: "networkidle2" });
    } catch (e) {
      // Many real sites (analytics beacons, chat widgets, websockets) never
      // drop to networkidle2's <=2-connections threshold — the page has
      // still loaded by this point, so capture it instead of failing the
      // whole thing over background chatter that was never going to stop.
      if (!(e instanceof TimeoutError)) throw e;
    }

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

// Capture + store the bytes in blob storage + upsert the shared per-URL cache
// row, in one step. Shared by the interactive /api/screenshot route (which
// wraps this with freshness-check + old-media cleanup) and the REST API's
// fire-and-forget capture below.
export async function captureAndCacheScreenshot(
  url: string,
  ownerId: string,
): Promise<{ image_url: string; title: string; description: string }> {
  const { image, title, description } = await captureWebsiteScreenshot(url);
  const sha256 = await putBlob(image, "image/png", ownerId);
  const image_url = await createMedia(sha256, ownerId, "public");
  await upsertScreenshot({ url, image_url, title, description });
  return { image_url, title, description };
}

// Each capture is a full headless Chromium — a burst of API calls (e.g. a bulk
// import) must not launch one per call. Caps how many run at once; the rest
// wait their turn. ponytail: fixed cap, revisit if this ever needs to be
// configurable per deployment size.
const MAX_CONCURRENT_CAPTURES = 3;
let activeCaptures = 0;
const captureQueue: (() => void)[] = [];

async function withCaptureSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeCaptures >= MAX_CONCURRENT_CAPTURES) {
    await new Promise<void>((resolve) => captureQueue.push(resolve));
  }
  activeCaptures++;
  try {
    return await fn();
  } finally {
    activeCaptures--;
    captureQueue.shift()?.();
  }
}

// One in-flight capture per URL — concurrent triggers for the same URL (e.g.
// several blocks added at once pointing at the same link) share it instead of
// each launching their own Chromium.
const inFlightCaptures = new Map<string, Promise<void>>();

// Kick off a capture in the background without making the caller wait on a
// multi-second Puppeteer run — this process stays up after the response is
// sent, so the capture just finishes on its own time. Skips URLs that already
// have a cached screenshot (shared per-URL, so another block may have already
// captured this one). Callers poll the block/channel API for `preview` to
// land once it's done. A permanent failure (dead site, DNS failure, blocks
// headless browsers, etc.) writes a null-image row instead of leaving none —
// that's what tells a poller to stop waiting instead of retrying for minutes
// on something that already failed.
export function triggerScreenshotCapture(url: string, ownerId: string): void {
  if (inFlightCaptures.has(url)) return;

  const promise = (async () => {
    let existing: ScreenshotRow | null;
    try {
      existing = await getScreenshot(url);
    } catch (e) {
      logError("screenshot.capture", `lookup failed for ${url}`, e);
      return;
    }
    if (existing?.image_url) return;

    const startedAt = Date.now();
    logInfo("screenshot.capture", `starting capture: ${url}`, {
      activeCaptures,
      queued: captureQueue.length,
    });
    try {
      await withCaptureSlot(() => captureAndCacheScreenshot(url, ownerId));
      logInfo("screenshot.capture", `captured ${url} in ${Date.now() - startedAt}ms`);
    } catch (e) {
      logError("screenshot.capture", `failed after ${Date.now() - startedAt}ms: ${url}`, e);
      try {
        await upsertScreenshot({ url, image_url: null, title: "", description: "" });
      } catch (upsertError) {
        logError("screenshot.capture", `failed to record capture failure for ${url}`, upsertError);
      }
    }
  })().finally(() => inFlightCaptures.delete(url));

  inFlightCaptures.set(url, promise);
}
