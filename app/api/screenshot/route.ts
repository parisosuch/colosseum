import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { deleteMediaByUrl } from "@/lib/colosseum/blob";
import { captureAndCacheScreenshot } from "@/lib/colosseum/screenshot";
import { getScreenshot } from "@/lib/colosseum/screenshot-data";

export const runtime = "nodejs"; // puppeteer is going to require nodejs runtime for browsing

// How long a cached screenshot is considered fresh. Past this, the next request
// for the URL recaptures it (lazy refresh — no background job). Treat a
// screenshot as a refreshing preview, not a permanent snapshot.
const SCREENSHOT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 401 });
  }

  // Ensure the caller is authenticated (session cookie — this endpoint is
  // only called same-origin from the app's own UI).
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reuse an already-captured screenshot for this URL instead of recapturing,
  // unless it has gone stale (older than the TTL). Screenshots are keyed by URL
  // (deterministic filename) and shared by every block/channel using that URL,
  // so recapturing a still-fresh one would waste a puppeteer run and overwrite
  // the image other blocks already display.
  let existing: Awaited<ReturnType<typeof getScreenshot>>;
  try {
    existing = await getScreenshot(url);
  } catch (lookupError) {
    console.error(lookupError);
    return NextResponse.json({ error: "Failed to look up screenshot" }, { status: 500 });
  }

  const isFresh =
    existing?.captured_at != null &&
    Date.now() - new Date(existing.captured_at).getTime() < SCREENSHOT_TTL_MS;

  if (existing?.image_url && isFresh) {
    return NextResponse.json({
      image_url: existing.image_url,
      title: existing.title,
      description: existing.description,
    });
  }

  try {
    // Stores the bytes in content-addressed local-disk blob storage behind a
    // public media reference and upserts the shared per-URL cache row (so a
    // stale row is refreshed in place — captured_at also serves as the
    // client cache-busting version).
    const {
      image_url: publicUrl,
      title,
      description,
    } = await captureAndCacheScreenshot(url, user.id);

    // The refresh replaced the row's media reference; drop the old one so its
    // blob can GC once nothing else points at it.
    if (existing?.image_url && existing.image_url !== publicUrl) {
      await deleteMediaByUrl(existing.image_url);
    }

    return NextResponse.json({ image_url: publicUrl, title, description });
  } catch (error) {
    console.error(error);

    return NextResponse.json({ error: error }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const requestURL = new URL(req.url);

  const targetURL = requestURL.searchParams.get("url");

  if (!targetURL) {
    return NextResponse.json({ error: "Missing url parameter." }, { status: 401 });
  }

  // look up if image exists in database
  let data: Awaited<ReturnType<typeof getScreenshot>>;
  try {
    data = await getScreenshot(targetURL);
  } catch (selectError) {
    return NextResponse.json({ error: selectError }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Screenshot for URL does not exist." }, { status: 404 });
  }

  // return screenshot data
  return NextResponse.json({ url: targetURL, ...data });
}
