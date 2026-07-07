// Open Graph / preview metadata for a channel share link (issue #180 lives in
// the PR, not here). Kept free of DB / server-only imports so it stays
// unit-testable, like og-meta.ts — the page loads the channel and hands it in.

import type { Metadata } from "next";

import type { Channel } from "./channel";

// Only public channels get a rich preview. A private (or missing) channel
// returns the generic site metadata, so its name, description, and owner never
// leak to whoever unfurls the link — you can't share a private channel anyway.
export function channelPreviewMeta(channel: Channel | null, handle: string): Metadata {
  if (!channel || channel.private) {
    return { title: "Colosseum" };
  }

  const title = `${channel.title} · Colosseum`;
  const byline = `channel by @${handle} on Colosseum`;
  const description = channel.description ? `${channel.description} — a ${byline}` : `A ${byline}`;
  const url = `/${handle}/${channel.id}`;

  return {
    title,
    description,
    openGraph: { title, description, url, siteName: "Colosseum", type: "website" },
    twitter: { card: "summary", title, description },
  };
}
