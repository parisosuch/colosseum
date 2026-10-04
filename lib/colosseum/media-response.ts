// The byte-serving half of the media route, after access has been decided: the
// `?thumb` rendition, CDN / signed-URL redirects, ETags and byte ranges. Shared
// by /api/media/<id> (session or bearer token) and /api/media/<id>/s/<token>
// (a share link), which differ only in who they let through.

import { NextRequest, NextResponse } from "next/server";

import { blobKey, ensureThumbnail, getMedia, isVideoMime, thumbKey } from "./blob";
import {
  etagMatches,
  MEDIA_REDIRECT_CACHE_CONTROL,
  mediaCacheControl,
  mediaEtag,
} from "./media-cache";
import { getObject, objectSize, publicUrl, signedUrl } from "./storage";

export type MediaItem = NonNullable<Awaited<ReturnType<typeof getMedia>>>;

export function mediaNotFound(): NextResponse {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

// Serve one media item to a viewer who has already passed the access check.
export async function serveMedia(req: NextRequest, item: MediaItem): Promise<Response> {
  // `?thumb` serves a downsized webp derived from the same bytes (used by grid
  // previews) — the image itself, or a decoded frame for a video. Generation is
  // idempotent + cached; an undecodable blob (or any failure) falls back to the
  // full bytes.
  //
  // The row already tells us whether the rendition is stored, so the common
  // case — every tile of every grid — goes straight to the key. Only a blob
  // that predates its thumbnail takes the lazy path, which probes storage and
  // resizes on the way through, then marks the row so the next request doesn't.
  let key = blobKey(item.sha256);
  let contentType = item.mime;
  let servingThumb = false;
  if (req.nextUrl.searchParams.has("thumb")) {
    const thumb = item.has_thumbnail
      ? thumbKey(item.sha256)
      : await ensureThumbnail(item.sha256, item.mime).catch(() => null);
    if (thumb) {
      key = thumb;
      contentType = "image/webp";
      servingThumb = true;
    } else if (isVideoMime(item.mime)) {
      // No poster could be made (no ffmpeg, or a file it can't decode). The
      // asker is an <img>, so falling through would hand it the whole video —
      // the exact request `?thumb` exists to replace. 404 instead; the card
      // draws its placeholder off the error.
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  }

  // Keep the app off the byte path when the backend can serve the object
  // itself. Public → a cacheable CDN/edge URL. Private → a short-lived signed
  // URL, minted only after the ownership check above, so access stays gated.
  // Either falls back to streaming when the backend can't hand out a URL
  // (local disk, or S3 without a CDN for public).
  if (item.visibility === "public") {
    const url = publicUrl(key);
    if (url) {
      // Cached in the viewer's own browser, not in any shared cache — see
      // MEDIA_REDIRECT_CACHE_CONTROL for why a public redirect still gets a
      // private policy. Without it a grid re-requests this per tile, per view.
      return NextResponse.redirect(url, {
        status: 302,
        headers: { "Cache-Control": MEDIA_REDIRECT_CACHE_CONTROL },
      });
    }
  } else {
    const url = await signedUrl(key);
    if (url) {
      // The redirect itself must never be cached — the signature expires and
      // is per-viewer; only the private user who just authorized may follow it.
      return NextResponse.redirect(url, {
        status: 302,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
  }

  // A media id's bytes never change, so the sha is a strong validator and
  // public responses cache forever. Private ones may be stored by the viewer's
  // own browser but never reused without revalidating here — see
  // lib/colosseum/media-cache.ts for why that's the safe shape.
  const cacheControl = mediaCacheControl(item.visibility);
  const etag = mediaEtag(item.sha256, servingThumb);

  // Honor a byte-range request (video seeking; Safari won't play a video at all
  // without one). Only reached on the streaming path — CDN/signed-URL redirects
  // above hand range off to the object store's own edge. Unparseable/absent
  // Range falls through to the full 200.
  const range = req.headers.get("range");

  // The viewer already holds these bytes: they passed the access check above,
  // so hand back a 304 and let them paint from their own cache. Skipped for a
  // ranged request — a player that asked for bytes N..M expects a 206, and
  // some (Safari's, notably) handle a 304 there badly.
  if (!range && etagMatches(req.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match && (match[1] || match[2])) {
    const total = await objectSize(key);
    if (total == null) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const start = match[1] ? Number(match[1]) : total - Number(match[2]);
    const end = match[1] && match[2] ? Number(match[2]) : total - 1;
    if (start > end || start < 0 || end >= total) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
      });
    }
    const slice = await getObject(key, { start, end });
    if (!slice) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return new Response(slice.body, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
        ETag: etag,
      },
    });
  }

  const object = await getObject(key);
  if (!object) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(object.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
      ETag: etag,
    },
  });
}
