import "server-only";

import {
  githubRef,
  instagramRef,
  tweetIdFromUrl,
  urlBlockKind,
  youtubeChannelRef,
} from "@/lib/utils";
import { logError } from "@/lib/log";
import { putImageBlobFromUrl } from "./blob";
import {
  type Column,
  uploadGitHubColumn,
  uploadImageColumn,
  uploadInstagramColumn,
  uploadSpotifyColumn,
  uploadTweetColumn,
  uploadURLColumn,
  uploadYouTubeChannelColumn,
  uploadYouTubeColumn,
} from "./column";
import { fetchGitHubMeta } from "./github";
import { fetchInstagramMeta } from "./instagram";
import { ingestTweet } from "./tweet";
import { fetchYouTubeChannelMeta } from "./youtube-channel";

// Turning a URL into the right kind of block: detect what it points at, fetch
// what that kind needs, and store it.
//
// This used to live in uploadURLColumnAction, which meant it only ran for the
// web app — the same github.com link was a rich card in the browser and a bare
// url block with a screenshot over the API. A server action can't be called
// from a route handler (it reads the session cookie), so the work had to come
// out of the action rather than the API reaching in.
//
// Authorization is the caller's: contribute to the channel, and charge the
// block quota. Everything here assumes that already happened.
//
// Every one of these falls back to a plain url block when its lookup fails, so
// a dead link, a rate-limited API or an unreachable host still lands as
// something — and none of them can recurse back into the dispatch.

type IngestInput = {
  url: string;
  userId: string;
  channelId: number;
  // Whether the destination channel is private, which decides the privacy scope
  // any fetched media is stored under. A public avatar pulled into a private
  // channel must not stay publicly addressable.
  channelPrivate: boolean;
};

function plainUrl(input: IngestInput): Promise<Column> {
  return uploadURLColumn({
    created_by: input.userId,
    channel_id: input.channelId,
    text: input.url,
  });
}

// Fetch an image into blob storage under the channel's privacy scope. Every
// caller here treats it as best-effort: a card with no picture still reads,
// and failing the whole add over an avatar would be worse.
async function ingestImage(
  imageUrl: string,
  input: IngestInput,
  scope: string,
): Promise<string | undefined> {
  try {
    return await putImageBlobFromUrl(
      imageUrl,
      input.userId,
      input.channelPrivate ? "private" : "public",
    );
  } catch (e) {
    logError(scope, `image fetch failed for ${imageUrl}`, e);
    return undefined;
  }
}

export async function ingestTweetColumn(input: IngestInput): Promise<Column> {
  const id = tweetIdFromUrl(input.url);
  if (id && (await ingestTweet(id, input.userId))) {
    // Store a canonical id-based permalink, not the pasted URL: the snapshot is
    // shared per tweet id, so every block for the same tweet must carry the same
    // url string for the shared-snapshot GC (deleteTweetIfUnreferenced) to see
    // its siblings. x.com/i/status/<id> redirects to the real tweet.
    return uploadTweetColumn({
      created_by: input.userId,
      channel_id: input.channelId,
      url: `https://x.com/i/status/${id}`,
    });
  }
  return plainUrl(input);
}

// The video's title via YouTube's public oEmbed endpoint (no API key, returns
// only metadata — not the video itself, so it stays within "don't persist the
// video"). Best-effort: undefined if the lookup fails, and the block is created
// untitled rather than failing the add.
async function youtubeTitle(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { title?: string };
    return data.title || undefined;
  } catch (e) {
    logError("youtube.oembed", `title lookup failed for ${url}`, e);
    return undefined;
  }
}

// Stores the URL and the video's title; the embed renders live from YouTube,
// nothing else is captured (persisting the video would be too costly).
export async function ingestYouTubeColumn(input: IngestInput): Promise<Column> {
  return uploadYouTubeColumn({
    created_by: input.userId,
    channel_id: input.channelId,
    url: input.url,
    title: await youtubeTitle(input.url),
  });
}

// A channel has no embeddable player, so this resolves its name, blurb and
// avatar up front and stores them — the card renders from our own data instead
// of an iframe. The avatar is ingested into blob storage like a tweet's media,
// so the card survives YouTube rotating the image URL, and it's GC'd with the
// block.
export async function ingestYouTubeChannelColumn(input: IngestInput): Promise<Column> {
  const ref = youtubeChannelRef(input.url);
  const meta = ref ? await fetchYouTubeChannelMeta(ref.url) : null;
  if (!ref || !meta) return plainUrl(input);

  const image = meta.avatarUrl
    ? await ingestImage(meta.avatarUrl, input, "youtube.channel.avatar")
    : undefined;

  return uploadYouTubeChannelColumn({
    created_by: input.userId,
    channel_id: input.channelId,
    url: meta.url,
    title: meta.title || ref.label,
    description: meta.description || undefined,
    image,
  });
}

// A repo or an account. Resolves the name, description, avatar and (for a repo)
// the primary language up front and stores them — the card renders from our own
// data, which beats a screenshot of a page that is mostly navigation chrome.
export async function ingestGitHubColumn(input: IngestInput): Promise<Column> {
  const ref = githubRef(input.url);
  const meta = ref ? await fetchGitHubMeta(ref) : null;
  if (!ref || !meta) return plainUrl(input);

  const image = meta.avatarUrl
    ? await ingestImage(meta.avatarUrl, input, "github.avatar")
    : undefined;

  return uploadGitHubColumn({
    created_by: input.userId,
    channel_id: input.channelId,
    url: meta.url,
    title: meta.title,
    description: meta.description || undefined,
    image,
    language: meta.language || undefined,
  });
}

// A post, a reel, or an account. The picture is ingested into blob storage —
// Instagram's CDN URLs are signed and expire, so a card pointing at one would
// be broken within days, and a screenshot of the page is a login wall. The
// video behind a reel is not persisted (same reason a YouTube block doesn't), so
// a reel is its cover frame and a link out.
export async function ingestInstagramColumn(input: IngestInput): Promise<Column> {
  const ref = instagramRef(input.url);
  if (!ref) return plainUrl(input);

  const meta = await fetchInstagramMeta(ref.url);
  const image = meta ? await ingestImage(meta.imageUrl, input, "instagram.image") : undefined;

  // A failed lookup still makes an Instagram block, not a link block. Instagram
  // range-blocks whole hosts, and it blocks the screenshot capture the same way,
  // so a link block for an Instagram URL is a permanently blank card that reads
  // as a broken scrape. Everything the card needs to stand on its own is already
  // in the URL — the handle, and whether it points at a post or a profile. The
  // picture is the only thing missing, and the card draws its mark without one.
  return uploadInstagramColumn({
    created_by: input.userId,
    channel_id: input.channelId,
    url: meta?.url ?? ref.url,
    title: meta?.title || (ref.username ? `@${ref.username}` : "Instagram"),
    description: meta?.description || undefined,
    image,
  });
}

// Title + cover-art URL via Spotify's public oEmbed endpoint (no API key,
// metadata only). Best-effort: empty on failure so the block is still created.
async function spotifyMeta(url: string): Promise<{ title?: string; image?: string }> {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return {};
    const data = (await res.json()) as { title?: string; thumbnail_url?: string };
    return { title: data.title || undefined, image: data.thumbnail_url || undefined };
  } catch (e) {
    logError("spotify.oembed", `metadata lookup failed for ${url}`, e);
    return {};
  }
}

// Stores the URL plus the item's title and cover art; the player renders live
// from Spotify's iframe, nothing else is captured.
export async function ingestSpotifyColumn(input: IngestInput): Promise<Column> {
  const { title, image } = await spotifyMeta(input.url);
  return uploadSpotifyColumn({
    created_by: input.userId,
    channel_id: input.channelId,
    url: input.url,
    title,
    image,
  });
}

// Decide a URL's block type and ingest it as that. Every path that accepts a
// URL ends here — the channel input, the quick-add drawer, the REST API and the
// MCP tool — so a link lands the same way whoever added it.
export async function ingestUrlColumn(input: IngestInput): Promise<Column> {
  switch (urlBlockKind(input.url)) {
    case "tweet":
      return ingestTweetColumn(input);
    case "youtube_channel":
      return ingestYouTubeChannelColumn(input);
    case "youtube":
      return ingestYouTubeColumn(input);
    case "spotify":
      return ingestSpotifyColumn(input);
    case "github":
      return ingestGitHubColumn(input);
    case "instagram":
      return ingestInstagramColumn(input);
    case "image": {
      const image = await ingestImage(input.url, input, "column.url.image");
      if (image) {
        return uploadImageColumn({
          created_by: input.userId,
          channel_id: input.channelId,
          image,
        });
      }
      break;
    }
    case "url":
      break;
  }
  return plainUrl(input);
}
