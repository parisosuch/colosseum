// Metadata for a YouTube channel block: the channel's name, blurb, and avatar.
//
// YouTube has no oEmbed endpoint for channels and no embeddable channel player,
// so a channel block is a card we compose ourselves rather than an iframe. The
// data comes from the channel page's own Open Graph tags, which a plain fetch
// gets without hitting the consent interstitial a headless render would.
//
// Deliberately free of DB / server-only imports so the parser stays
// unit-testable, like og-meta.ts.

import { DESKTOP_UA, parseOgMeta } from "./og-meta";

export type YouTubeChannelMeta = {
  // The channel's display name, e.g. "Syntax".
  title: string;
  // The channel blurb, trimmed to what a card can show.
  description: string;
  // The channel avatar, or null when the page didn't publish one.
  avatarUrl: string | null;
  // Where the block links: the @handle URL when the page names one (the form a
  // person recognizes), else the URL that was fetched.
  url: string;
};

// YouTube serves the same page for /@handle, /channel/UC…, and the legacy
// forms, and names the handle URL in its embedded player config. Pulling it out
// means a block added from /channel/UC… still links to the readable /@handle.
function vanityUrl(html: string): string | null {
  const m = /"vanityChannelUrl":"([^"]+)"/.exec(html);
  if (!m) return null;
  const raw = m[1].replace(/\\\//g, "/");
  try {
    const u = new URL(raw);
    // Normalize the scheme — the embedded value is http:// even though the
    // channel is served over https.
    return `https://www.youtube.com${u.pathname}`;
  } catch {
    return null;
  }
}

// Parse a fetched channel page. `requestUrl` is the URL the HTML came from, used
// both to resolve a relative og:image and as the link target of last resort.
export function parseYouTubeChannelMeta(html: string, requestUrl: string): YouTubeChannelMeta {
  const og = parseOgMeta(html, requestUrl);
  return {
    title: og.title,
    description: og.description,
    avatarUrl: og.imageUrl,
    url: vanityUrl(html) ?? requestUrl,
  };
}

// How long to wait on the channel page. This runs while the user waits for
// their block to appear, so it's tighter than a screenshot capture's budget.
const FETCH_TIMEOUT_MS = 10_000;

// Fetch and parse a channel page. Returns null when the page can't be fetched or
// doesn't identify a channel (a 404 handle, a network failure, YouTube changing
// shape) — the caller falls back to a plain link block rather than failing the
// add.
export async function fetchYouTubeChannelMeta(url: string): Promise<YouTubeChannelMeta | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const meta = parseYouTubeChannelMeta(await res.text(), url);
  // No name means we didn't get a channel page — a card with a blank heading is
  // worse than the link block the caller falls back to.
  return meta.title ? meta : null;
}
