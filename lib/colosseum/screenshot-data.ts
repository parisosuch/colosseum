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

// Batch-fetch cached screenshot rows for many URLs in a single query, instead
// of one request per column. Returns a map keyed by url; URLs without a cached
// screenshot are simply absent from the map.
export async function getScreenshotsForUrls(
  supabase: SupabaseClient,
  urls: string[],
): Promise<Map<string, ColumnScreenshot>> {
  const screenshots = new Map<string, ColumnScreenshot>();
  if (urls.length === 0) {
    return screenshots;
  }

  const { data, error } = await supabase
    .from("screenshot")
    .select("url, image_url, title, captured_at")
    .in("url", urls);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of data ?? []) {
    screenshots.set(row.url, row as ColumnScreenshot);
  }
  return screenshots;
}
