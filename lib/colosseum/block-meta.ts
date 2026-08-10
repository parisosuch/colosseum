// Open Graph / preview metadata for a block share link. Kept free of DB /
// server-only imports so it stays unit-testable, like channel-meta.ts — the page
// loads the block, its channel, and any cached preview, and hands them in.

import type { Metadata } from "next";

import type { Channel } from "./channel";
import type { Column } from "./column";
import { SITE_CARD } from "./share-card";
import { youtubeIdFromUrl } from "@/lib/utils";

// What a block is called when it has no title of its own. Shared with the block
// page's heading so a link preview and the page it opens agree.
export function blockLabel(column: Column): string {
  if (column.title) return column.title;
  if (column.type === "url") return column.url ?? "Link";
  if (column.type === "text") return "Text column";
  if (column.type === "pdf") return "PDF column";
  if (column.type === "video") return "Video column";
  if (column.type === "youtube") return "YouTube video";
  if (column.type === "spotify") return "Spotify";
  return "Column";
}

// The picture an unfurling client should show, or null when this block has none
// to offer. Every candidate has to be fetchable without a session, since the
// thing loading it is someone else's server:
//
// - image blocks point `image` at their uploaded media, which is public for a
//   public channel.
// - url blocks reuse the cached preview the block itself renders.
// - youtube blocks have a thumbnail derivable from the video id.
//
// pdf and video blocks also fill `image`, but with the PDF or the video file
// rather than a picture, so they'd hand back something no client can render.
// text and channel blocks have nothing at all. Both cases give up and let the
// card fall back to text.
export function blockShareImage(
  column: Column,
  previewUrl: string | null,
): { url: string; width?: number; height?: number } | null {
  if (column.type === "image" && column.image) {
    return { url: column.image };
  }
  if (column.type === "url" && previewUrl) {
    // Captures are stored as a fixed square; saying so lets a client lay the
    // card out before it has fetched the bytes.
    return { url: previewUrl, width: 1200, height: 1200 };
  }
  if (column.type === "youtube" && column.url) {
    const id = youtubeIdFromUrl(column.url);
    if (id) return { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 };
  }
  return null;
}

/**
 * Preview metadata for a block permalink.
 *
 * `previewDescription` is the page description captured alongside a URL block's
 * screenshot; it stands in when the block carries no description of its own.
 *
 * A block in a private channel gets the generic site metadata and nothing else.
 * The page's own loader already returns nothing to a viewer who can't read the
 * channel, so a crawler never reaches this with a private block — but a member
 * does, and there's no reason to build a share card for something the person
 * receiving the link could never open.
 */
export function blockPreviewMeta(input: {
  column: Column;
  channel: Channel;
  handle: string;
  previewUrl?: string | null;
  previewDescription?: string | null;
}): Metadata {
  const { column, channel, handle } = input;
  const label = blockLabel(column);
  const title = `${label} · Colosseum`;

  if (channel.private) {
    return { title };
  }

  const byline = `In ${channel.title}, a channel by @${handle} on Colosseum`;
  const own = column.description || (column.type === "text" ? column.text : "");
  const description = (own || input.previewDescription || byline).slice(0, 300);
  const url = `/${handle}/${channel.id}/${column.id}`;
  // A text or PDF block has no picture of its own, and falls back to the site
  // card rather than to nothing — see SITE_CARD for why that has to be said out
  // loud here.
  const image = blockShareImage(column, input.previewUrl ?? null) ?? SITE_CARD;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "Colosseum",
      type: "article",
      images: [{ ...image, alt: label }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
