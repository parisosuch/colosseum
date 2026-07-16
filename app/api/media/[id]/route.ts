// Serves stored bytes for one media reference (see lib/colosseum/blob.ts).
// This is the only route that serves blob bytes; nothing serves them by hash,
// so dedup can never leak a private image through a public URL.
//
// Private media is owner-only, which matches channel access today: private
// channels are readable only by their owner, and media visibility is kept in
// sync with the owning channel's privacy. Signed URLs stay deferred — a
// single-container deploy has no shared cache in front of this route.

import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { blobKey, ensureThumbnail, getMedia, thumbKey } from "@/lib/colosseum/blob";
import { getObject, publicUrl } from "@/lib/colosseum/storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const item = await getMedia(id);
  if (!item) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (item.visibility === "private") {
    const user = await getSessionUser();
    // 404, not 403, so a private image's existence never leaks.
    if (user?.id !== item.owner_id) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  }

  // `?thumb` serves a downsized webp derived from the same bytes (used by grid
  // previews). Generation is idempotent + cached; a non-image blob (or any
  // failure) falls back to the full bytes.
  let key = blobKey(item.sha256);
  let contentType = item.mime;
  if (req.nextUrl.searchParams.has("thumb")) {
    const thumb = await ensureThumbnail(item.sha256).catch(() => null);
    if (thumb) {
      key = thumbKey(item.sha256);
      contentType = "image/webp";
    }
  }

  // If the backend can serve this object from a CDN/edge, send public traffic
  // straight there instead of streaming every byte through the app. Private
  // media never redirects — it always streams so access stays authorized.
  if (item.visibility === "public") {
    const url = publicUrl(key);
    if (url) {
      return NextResponse.redirect(url, 302);
    }
  }

  const object = await getObject(key);
  if (!object) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // A media id's bytes never change, so public responses cache forever;
  // private ones must never land in any cache.
  const cacheControl =
    item.visibility === "private" ? "private, no-store" : "public, max-age=31536000, immutable";

  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(object.size),
      "Cache-Control": cacheControl,
    },
  });
}
