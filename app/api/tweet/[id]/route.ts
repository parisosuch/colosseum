// Serves a stored tweet snapshot to the client renderer (react-tweet's
// `useTweet` hook, pointed here via apiUrl). Returns the same `{ data }` shape
// the syndication API returns, but from our own copy — so the block renders
// identically after the original tweet is gone. 404 when we never captured it.
//
// Self-hosted media stays root-relative (`/api/media/<id>`) in the response;
// TweetBlock absolutizes it against the browser origin at render time, so the
// URLs resolve on the right host/scheme behind any proxy.

import { NextRequest, NextResponse } from "next/server";

import { getTweet } from "@/lib/colosseum/tweet";

const ID_RE = /^\d+$/;

// A snapshot is captured once and never re-fetched (see lib/colosseum/tweet.ts),
// so an id names one payload for as long as the row lives — the same kind of
// fact as a media id naming one blob, and cached the same way. Nothing here is
// per-viewer: the route takes no session and answers on the snowflake alone, so
// a shared cache can hold one copy for everyone.
//
// The tail this trades away: a GC'd tweet (deleteTweetIfUnreferenced) that is
// later re-added mints new media ids, and a browser still holding the old
// snapshot renders its images broken until the entry expires. That needs the
// last block linking a tweet deleted *and* the tweet re-added *and* a viewer
// carrying a stale copy across both — against a re-download of every snapshot
// on every page load, in a grid that renders one fetch per tweet card.
//
// Only the 200 carries it. A 404 is spelled `no-store` rather than left bare:
// an id we haven't captured yet is one an add could capture a moment later, and
// a bare 404 is heuristically cacheable, which would pin the miss.
const SNAPSHOT_CACHE_CONTROL = "public, max-age=31536000, immutable";

const notFound = () =>
  NextResponse.json(
    { error: "Not found." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return notFound();
  }
  const data = await getTweet(id);
  if (!data) {
    return notFound();
  }
  return NextResponse.json({ data }, { headers: { "Cache-Control": SNAPSHOT_CACHE_CONTROL } });
}
