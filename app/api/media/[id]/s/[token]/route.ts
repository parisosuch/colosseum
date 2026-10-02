// A share link's view of one media item: /api/media/<id>/s/<token>. The token
// takes the place of a session, and opens only the media of blocks the link
// covers — any block of a shared channel, or the one block of a block link.
// Everything after the check is the ordinary media route (serveMedia).

import { NextRequest, NextResponse } from "next/server";

import { getMedia } from "@/lib/colosseum/blob";
import { mediaNotFound, serveMedia } from "@/lib/colosseum/media-response";
import { resolveShareRequest, shareCoversMedia } from "@/lib/colosseum/share-link";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; token: string }> },
) {
  const { id, token } = await ctx.params;
  if (!UUID_RE.test(id)) return mediaNotFound();

  const share = await resolveShareRequest(token, req.headers);
  if (share === "limited") {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  if (!share) return mediaNotFound();

  const item = await getMedia(id);
  if (!item) return mediaNotFound();
  // A public file needs no link to read, but it still has to be one this link
  // shows, or the route would serve as a lookup for anything by id.
  if (!(await shareCoversMedia(share, id))) return mediaNotFound();

  return serveMedia(req, item);
}
