// Serves a stored tweet snapshot to the client renderer (react-tweet's
// `useTweet` hook, pointed here via apiUrl). Returns the same `{ data }` shape
// the syndication API returns, but from our own copy — so the block renders
// identically after the original tweet is gone. 404 when we never captured it.

import { NextRequest, NextResponse } from "next/server";

import { absolutizeMediaUrls, getTweet } from "@/lib/colosseum/tweet";

const ID_RE = /^\d+$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const data = await getTweet(id);
  if (!data) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  // Self-hosted media is stored relative; make it absolute for react-tweet's
  // getMediaUrl (which does `new URL(...)` on the photo src).
  absolutizeMediaUrls(data, req.nextUrl.origin);
  return NextResponse.json({ data });
}
