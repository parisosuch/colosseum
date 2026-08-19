// Open Graph / preview metadata for a channel share link (issue #180 lives in
// the PR, not here). Kept free of DB / server-only imports so it stays
// unit-testable, like og-meta.ts — the page loads the channel and hands it in.

import type { Metadata } from "next";

import type { Channel } from "./channel";
import { SITE_CARD } from "./share-card";

// Only public channels get a rich preview. A private (or missing) channel
// returns the generic site metadata, so its name, description, and owner never
// leak to whoever unfurls the link — you can't share a private channel anyway.
// `imageUrl` is a picture from inside the channel, used as the card's image so
// a shared channel shows what's in it. Omitted for a channel with nothing
// suitable, which falls back to a text card.
export function channelPreviewMeta(
  channel: Channel | null,
  handle: string,
  imageUrl?: string | null,
): Metadata {
  if (!channel || channel.private) {
    return { title: "Colosseum" };
  }

  const title = `${channel.title} · Colosseum`;
  const byline = `channel by @${handle} on Colosseum`;
  const description = channel.description ? `${channel.description} — a ${byline}` : `A ${byline}`;
  const url = `/${handle}/${channel.id}`;
  // Falls back to the site card, not to nothing — see SITE_CARD.
  const image = imageUrl ? { url: imageUrl } : SITE_CARD;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "Colosseum",
      type: "website",
      images: [{ ...image, alt: channel.title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
