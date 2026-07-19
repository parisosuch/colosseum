// Deletion-resilient tweet embedding. When a user adds a tweet URL we fetch its
// structured data once (X's public syndication endpoint, no API key), download
// its images to our own blob storage, rewrite the snapshot to point at those
// copies, and store it. Everything then renders from our copy — the block
// survives the tweet being deleted, going private, or the account suspended.
//
// Capture is one-way: we store on first add and never re-fetch, so there's no
// path that could overwrite a good snapshot with a later tombstone. See the
// `tweet` table in lib/db/schema.ts.

import "server-only";

import { fetchTweet, type Tweet } from "react-tweet/api";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { column, tweet as tweetTable } from "@/lib/db/schema";
import { logError } from "@/lib/log";
import { deleteMediaByUrl, putImageBlobFromUrl } from "./blob";

// Note: URL parsing (tweetIdFromUrl / isTweetUrl) lives in lib/utils so client
// components can classify a pasted URL without importing this server-only module.

// Read a stored snapshot for rendering. Null when we never captured this tweet.
export async function getTweet(id: string): Promise<Tweet | null> {
  const [row] = await db
    .select({ data: tweetTable.data })
    .from(tweetTable)
    .where(eq(tweetTable.id, id))
    .limit(1);
  return (row?.data as Tweet | undefined) ?? null;
}

// We store media URLs relative (`/api/media/<id>`) so a snapshot isn't pinned to
// one origin — TweetBlock absolutizes them against the browser origin at render
// time (a server-derived origin behind a proxy is the wrong host/scheme). The
// snapshot therefore keeps them relative all the way through.

// Fetch an image URL into our blob storage and return its self-hosted media URL.
// Falls back to the original URL if the download fails — a live URL that may rot
// later still beats a broken image now. Records every URL we did self-host so
// the caller can persist them for GC.
async function selfHost(
  imageUrl: string | undefined,
  ownerId: string,
  hosted: string[],
): Promise<string | undefined> {
  if (!imageUrl) return imageUrl;
  try {
    const url = await putImageBlobFromUrl(imageUrl, ownerId, "public");
    hosted.push(url);
    return url;
  } catch (e) {
    logError("tweet.ingest", `couldn't self-host ${imageUrl}`, e);
    return imageUrl;
  }
}

// Rewrite the image URLs in a tweet (avatar + photo/video-poster media) to
// self-hosted blobs, in place. Recurses into the quoted tweet. ponytail: video
// itself (video_info.variants) is left pointing at twimg, so a video plays live
// but dies with the tweet; self-hosting the MP4 needs a streaming download +
// byte cap and is the obvious follow-up. Photos, GIFs' poster frames, and
// avatars — the common case — are fully persisted.
async function rewriteMedia(t: Tweet, ownerId: string, hosted: string[]): Promise<void> {
  t.user.profile_image_url_https = (await selfHost(
    t.user.profile_image_url_https,
    ownerId,
    hosted,
  ))!;
  for (const media of t.mediaDetails ?? []) {
    media.media_url_https = (await selfHost(media.media_url_https, ownerId, hosted))!;
  }
  if (t.quoted_tweet) {
    await rewriteMedia(t.quoted_tweet as unknown as Tweet, ownerId, hosted);
  }
}

// Capture a tweet on first add: fetch its data, self-host its images, and store
// the rewritten snapshot. Idempotent per id — if we already captured this tweet
// (another user added it), we keep the existing snapshot and skip the refetch.
// Returns true when a snapshot exists afterwards (fresh or already stored),
// false when the tweet couldn't be fetched (deleted/not found/endpoint down) so
// the caller can fall back to a plain URL block.
export async function ingestTweet(id: string, ownerId: string): Promise<boolean> {
  if (await getTweet(id)) return true;

  let result: Awaited<ReturnType<typeof fetchTweet>>;
  try {
    result = await fetchTweet(id);
  } catch (e) {
    logError("tweet.ingest", `fetch failed for ${id}`, e);
    return false;
  }
  if (!result.data) return false; // tombstone / notFound

  const snapshot = result.data;
  const hosted: string[] = [];
  await rewriteMedia(snapshot, ownerId, hosted);

  // Another session may have captured the same tweet between our getTweet check
  // and here; do nothing on conflict so the first snapshot wins (capture-once).
  const [inserted] = await db
    .insert(tweetTable)
    .values({ id, data: snapshot, media_urls: hosted })
    .onConflictDoNothing()
    .returning({ id: tweetTable.id });

  // We lost the race: our freshly-downloaded blobs are now unreferenced. Drop
  // them so a concurrent add doesn't leak duplicate media.
  if (!inserted) {
    for (const url of hosted) await deleteMediaByUrl(url);
  }
  return true;
}

// GC a captured tweet once no column anywhere still links it: drop its
// self-hosted media (each blob is freed when this was its last reference) and
// the snapshot row. Mirrors deleteScreenshotIfUnreferenced. No-op while any
// column still references the tweet's URL.
export async function deleteTweetIfUnreferenced(id: string, url: string): Promise<void> {
  const [stillReferenced] = await db
    .select({ id: column.id })
    .from(column)
    .where(eq(column.url, url))
    .limit(1);
  if (stillReferenced) return;

  const [dropped] = await db
    .delete(tweetTable)
    .where(eq(tweetTable.id, id))
    .returning({ media_urls: tweetTable.media_urls });
  for (const mediaUrl of dropped?.media_urls ?? []) {
    await deleteMediaByUrl(mediaUrl);
  }
}
