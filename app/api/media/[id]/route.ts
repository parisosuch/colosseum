// Serves stored bytes for one media reference (see lib/colosseum/blob.ts).
// This is the only route that serves blob bytes; nothing serves them by hash,
// so dedup can never leak a private image through a public URL.
//
// Private media is readable by anyone who can read a channel that embeds it —
// the owner, and the members of a private channel. Media visibility is kept in
// sync with the owning channel's privacy. Signed URLs stay deferred — a
// single-container deploy has no shared cache in front of this route.

import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getMedia } from "@/lib/colosseum/blob";
import { canReadMedia } from "@/lib/colosseum/channel";
import { serveMedia } from "@/lib/colosseum/media-response";
import { resolveApiToken } from "@/lib/colosseum/api-auth";

// Resolve an `Authorization: Bearer` token to the same shape getSessionUser
// returns, so the check below reads identically for both.
async function viewerFromBearer(req: NextRequest): Promise<{ id: string } | null> {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const auth = await resolveApiToken(token).catch(() => null);
  return auth ? { id: auth.userId } : null;
}

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
    // A session cookie, or a bearer token. Without the token branch a client
    // that uploaded a file into its own private channel over the API could not
    // read it back — the URL it was handed would 404 for the only credential it
    // has. Same rule either way; only the way the viewer is identified differs.
    const user = (await getSessionUser()) ?? (await viewerFromBearer(req));
    // Owner always; otherwise anyone who can read a channel that embeds it (a
    // private channel's members, not just its owner). 404, not 403, so a
    // private image's existence never leaks.
    const allowed = user?.id === item.owner_id || (await canReadMedia(id, user?.id ?? null));
    if (!allowed) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  }

  return serveMedia(req, item);
}
