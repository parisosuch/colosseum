import { TimeoutError, type HTTPResponse } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import sharp from "sharp";

import { createMedia, putBlob } from "./blob";
import { DESKTOP_UA, fetchOgFallback } from "./og-meta";
import { getScreenshot, upsertScreenshot, ScreenshotRow } from "./screenshot-data";
import { logError, logInfo } from "@/lib/log";

// Stealth patches the automation fingerprints (navigator.webdriver, the
// HeadlessChrome UA, missing Accept-Language, and ~9 others) that bot
// protection reads to serve a challenge instead of the page. Registered once at
// module load. It clears most public detectors but not IP-reputation walls
// (Cloudflare/DataDome from a datacenter IP) — those need a proxy/unlocker,
// which the og:image fallback below partly covers for free.
puppeteer.use(StealthPlugin());

export interface Screenshot {
  id: number;
  created_at: string;
  url: string;
  image_url: string;
  title: string;
}

/** Side length of the square screenshot, in pixels. */
export const SCREENSHOT_SIZE = 1200;

// Navigation waits, tuned for speed over completeness. The old engine waited
// for `networkidle2` under the default 30s timeout, so any site that keeps a
// connection open (analytics, chat widgets, websockets) burned the whole 30s
// before capturing. Instead: get the DOM up fast, then allow a short, bounded
// settle for late content — a chatty page can never block longer than
// NAV + SETTLE. Knobs; raise SETTLE_TIMEOUT_MS if client-rendered apps come out
// half-painted.
const NAV_TIMEOUT_MS = 15_000; // max wait for the initial DOM
const SETTLE_IDLE_MS = 500; // "quiet" window that counts as settled
const SETTLE_TIMEOUT_MS = 3_000; // max extra wait for that quiet window

// Resize any image to the SCREENSHOT_SIZE square. `cover` crops the overflow;
// full-page renders anchor to the top, og:image fallbacks stay centered (they're
// composed as a whole).
async function toSquarePng(buffer: Buffer, position: "top" | "centre"): Promise<Buffer> {
  return sharp(buffer)
    .resize(SCREENSHOT_SIZE, SCREENSHOT_SIZE, { fit: "cover", position })
    .png()
    .toBuffer();
}

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
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: SCREENSHOT_SIZE, height: SCREENSHOT_SIZE });
    await page.setUserAgent(DESKTOP_UA);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    let response: HTTPResponse | null = null;
    try {
      // Wait only for the DOM, not the network to fall idle — that's fast on
      // essentially every site and doesn't hang on background chatter.
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    } catch (e) {
      // Too slow to even parse its DOM in time — capture whatever rendered
      // rather than failing the whole thing.
      if (!(e instanceof TimeoutError)) throw e;
    }

    // A 4xx/5xx is an error or block page (e.g. a bot challenge), not real
    // content — bail so the caller can try the og:image fallback, which a plain
    // fetch (no automation fingerprint) often still gets.
    if (response && response.status() >= 400) {
      throw new Error(`navigation returned HTTP ${response.status()}`);
    }

    // Give late content (hero images, fonts, client-rendered apps fetching
    // their data) a brief, bounded window to settle. Capped low so a page that
    // never goes idle proceeds anyway — this is the fix for the old 30s wait.
    await page
      .waitForNetworkIdle({ idleTime: SETTLE_IDLE_MS, timeout: SETTLE_TIMEOUT_MS })
      .catch(() => {});

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

    // Full-page screenshot, then crop to the top square. A page shorter than
    // SCREENSHOT_SIZE (viewport width, but full-page height) would make a
    // fixed-offset `.extract()` request a region past the image's actual
    // bounds and throw ("bad extract area") — `resize` with `cover` always
    // produces exactly SCREENSHOT_SIZE square regardless of source size,
    // cropping a taller page or upscaling a shorter one, anchored to the top.
    const buffer = (await page.screenshot({ fullPage: true })) as Buffer;
    const image = await toSquarePng(buffer, "top");

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
  let image: Buffer;
  let title: string;
  let description: string;
  try {
    ({ image, title, description } = await captureWebsiteScreenshot(url));
  } catch (renderError) {
    // Live render failed or was blocked. Fall back to the site's published
    // og:image, which a plain fetch (no automation fingerprint) often still
    // gets. If there's no usable preview image either, there's genuinely
    // nothing to show — rethrow so the caller records the failure.
    logError("screenshot.capture", `render failed for ${url}, trying og:image`, renderError);
    const fallback = await fetchOgFallback(url, NAV_TIMEOUT_MS);
    if (!fallback) throw renderError;
    try {
      image = await toSquarePng(fallback.image, "centre");
    } catch {
      throw renderError; // the og:image wasn't a usable image
    }
    title = fallback.title;
    description = fallback.description;
  }

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
