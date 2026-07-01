import { SupabaseClient } from "@supabase/supabase-js";

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

// Max URLs per `.in("url", …)` query. The lookup is a GET, so the URL list
// rides in the request URL; chunking keeps it under the length cap PostgREST
// and proxies enforce when a channel has hundreds of URL blocks.
const SCREENSHOT_CHUNK_SIZE = 100;

// Batch-fetch cached screenshot rows for many URLs, instead of one request per
// column. Splits the URLs into bounded chunks (run in parallel) so the request
// URL can't overflow, then merges them. Returns a map keyed by url; URLs
// without a cached screenshot are simply absent from the map.
export async function getScreenshotsForUrls(
  supabase: SupabaseClient,
  urls: string[],
): Promise<Map<string, ColumnScreenshot>> {
  const screenshots = new Map<string, ColumnScreenshot>();
  if (urls.length === 0) {
    return screenshots;
  }

  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += SCREENSHOT_CHUNK_SIZE) {
    chunks.push(urls.slice(i, i + SCREENSHOT_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from("screenshot")
        .select("url, image_url, title, captured_at")
        .in("url", chunk);

      if (error) {
        throw new Error(error.message);
      }

      return data ?? [];
    }),
  );

  for (const rows of results) {
    for (const row of rows) {
      screenshots.set(row.url, row as ColumnScreenshot);
    }
  }
  return screenshots;
}
