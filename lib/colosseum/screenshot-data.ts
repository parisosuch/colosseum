import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { screenshot } from "@/lib/db/schema";

// Lightweight view of a cached screenshot row, safe to use on the client.
// (lib/colosseum/screenshot.ts pulls in puppeteer/sharp and must not be
// imported into client bundles.)
export type ColumnScreenshot = {
  url: string;
  image_url: string | null;
  title: string | null;
  // When the image was last captured; used to cache-bust the shared storage
  // object after a refresh (see app/api/screenshot/route.ts).
  captured_at: string | null;
};

// Batch-fetch cached screenshot rows for many URLs, instead of one request per
// column. Returns a map keyed by url; URLs without a cached screenshot are
// simply absent from the map.
export async function getScreenshotsForUrls(
  urls: string[],
): Promise<Map<string, ColumnScreenshot>> {
  const screenshots = new Map<string, ColumnScreenshot>();
  if (urls.length === 0) {
    return screenshots;
  }

  const rows = await db
    .select({
      url: screenshot.url,
      image_url: screenshot.image_url,
      title: screenshot.title,
      captured_at: screenshot.captured_at,
    })
    .from(screenshot)
    .where(inArray(screenshot.url, urls));

  for (const row of rows) {
    screenshots.set(row.url, {
      url: row.url,
      image_url: row.image_url,
      title: row.title,
      captured_at: row.captured_at?.toISOString() ?? null,
    });
  }
  return screenshots;
}

// A single cached screenshot row, or null when none has been captured for the
// URL yet. The description is included for the screenshot route's freshness
// check; the client-facing map above omits it.
export type ScreenshotRow = {
  image_url: string | null;
  title: string | null;
  description: string | null;
  captured_at: string | null;
};

export async function getScreenshot(url: string): Promise<ScreenshotRow | null> {
  const [row] = await db
    .select({
      image_url: screenshot.image_url,
      title: screenshot.title,
      description: screenshot.description,
      captured_at: screenshot.captured_at,
    })
    .from(screenshot)
    .where(eq(screenshot.url, url))
    .limit(1);
  if (!row) {
    return null;
  }
  return { ...row, captured_at: row.captured_at?.toISOString() ?? null };
}

// Upsert a freshly captured screenshot, refreshing a stale row in place so
// image_url/title/description are rewritten and captured_at is bumped (which
// also serves as the client cache-busting version). image_url is nullable so
// a permanently failed capture can still record "we tried, it didn't work" —
// distinct from no row at all ("still capturing") — see
// triggerScreenshotCapture in ./screenshot.
export async function upsertScreenshot(input: {
  url: string;
  image_url: string | null;
  title: string;
  description: string;
}): Promise<void> {
  await db
    .insert(screenshot)
    .values({ ...input, captured_at: new Date() })
    .onConflictDoUpdate({
      target: screenshot.url,
      set: {
        image_url: input.image_url,
        title: input.title,
        description: input.description,
        captured_at: sql`now()`,
      },
    });
}
