import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@supabase/supabase-js";
import { encodeUrlToFilename } from "@/lib/url-encoding";
import { captureWebsiteScreenshot } from "@/lib/colosseum/screenshot";
import { getScreenshot, upsertScreenshot } from "@/lib/colosseum/screenshot-data";

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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing auth token." }, { status: 400 });
  }

  const token = authHeader.replace("Bearer ", "");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // ensure user is authenticated first
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
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
    const { image: squareBuffer, title, description } = await captureWebsiteScreenshot(url);

    const fileName = `${encodeUrlToFilename(url)}.png`;

    // upload to supabase storage
    const { error } = await supabase.storage.from("screenshots").upload(fileName, squareBuffer, {
      contentType: "image/png",
      upsert: true,
    });

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("screenshots").getPublicUrl(fileName);

    // Upsert so a stale row is refreshed in place: image_url/title/description
    // get rewritten and captured_at is bumped, which also serves as the client
    // cache-busting version.
    try {
      await upsertScreenshot({ url, image_url: publicUrl, title, description });
    } catch (insertError) {
      console.error(insertError);
      return NextResponse.json({ error: "Failed to save screenshot" }, { status: 500 });
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
