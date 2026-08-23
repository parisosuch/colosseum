// Metadata for an Instagram block: a post's picture and caption, or an
// account's avatar, name, and bio.
//
// Instagram serves an ordinary browser fetch a login shell with no metadata in
// it at all, but still publishes full Open Graph tags to the crawlers that
// unfurl a shared link — which is exactly what this needs, so the fetch
// identifies itself as one. Nothing is logged in and nothing is rendered: this
// reads the same public preview tags Instagram hands anyone who pastes the link
// into a chat window.
//
// Like the GitHub card, nothing volatile is captured. Instagram publishes like
// and follower counts here and both are deliberately unused: metadata is
// fetched once when the block is created and never refreshed, so a count would
// freeze at whatever it was that day. Captions, bios, and names don't.
//
// Deliberately free of DB / server-only imports so the parser stays
// unit-testable, like og-meta.ts.

import { instagramRef } from "@/lib/utils";
import { metaContent, parseOgMeta } from "./og-meta";

export type InstagramMeta = {
  // Which card to draw. Read from Instagram's own og:type rather than from the
  // pasted path, so a share link that redirects lands as what it resolved to.
  kind: "post" | "account";
  // "@handle" for a post, whose subject is its picture; the account's display
  // name for an account.
  title: string;
  // The post's caption or the account's bio. Empty when there is none.
  description: string;
  // The post's picture (a reel's cover frame), or the account's avatar. Null
  // when the page published none.
  imageUrl: string | null;
  // Canonical instagram.com URL as Instagram spells it, so a block added from a
  // share link or a username-less /p/<code> URL still links to the real page —
  // and so the renderer can read post-or-account back off it.
  url: string;
};

// Instagram wraps the caption (and an account's bio) in double quotes after a
// prefix it composes itself: `Name on Instagram: "…"`. Greedy to the last quote
// so a caption containing quotes of its own comes back whole.
function quoted(s: string | null): string {
  const m = s ? /"([\s\S]*)"/.exec(s) : null;
  return m ? m[1].trim() : "";
}

// Parse a fetched Instagram page. `requestUrl` is the URL the HTML came from,
// used to resolve a relative og:image and as the link target of last resort.
// Null when the page carries no Open Graph type — the login shell, or something
// that isn't a post or a profile.
export function parseInstagramMeta(html: string, requestUrl: string): InstagramMeta | null {
  const type = metaContent(html, "property", "og:type");
  if (!type) return null;

  const og = parseOgMeta(html, requestUrl);
  const url = metaContent(html, "property", "og:url") || requestUrl;
  const ref = instagramRef(url);
  const username = ref?.username ?? null;

  if (type === "profile") {
    return {
      kind: "account",
      // og:title is "Name (@handle) • Instagram photos and videos". The name is
      // what a person recognizes, and the handle is already in the URL.
      title: og.title.split(" (@")[0].trim() || (username ? `@${username}` : "Instagram"),
      // og:description is a follower/post count line; the bio is quoted inside
      // the plain description, which is the half worth keeping.
      description: quoted(metaContent(html, "name", "description")),
      imageUrl: og.imageUrl,
      url,
    };
  }

  return {
    kind: "post",
    title: username ? `@${username}` : "Instagram",
    // The caption, from og:title ("Name on Instagram: <caption>") rather than
    // og:description, which prefixes the same caption with like and comment
    // counts that would freeze the day the block was added.
    description: quoted(metaContent(html, "property", "og:title")),
    imageUrl: og.imageUrl,
    url,
  };
}

// A link-preview crawler's UA. A desktop UA gets the login shell back — no
// og:image, no title, nothing to build a card from — and these tags exist to be
// read by whatever is about to show a preview of the link.
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

// How long to wait on Instagram. This runs while the user waits for their block
// to appear, so it matches the YouTube channel budget rather than a
// screenshot's.
const FETCH_TIMEOUT_MS = 10_000;

// Fetch and parse a post or profile page. Returns null when the page can't be
// fetched or published no picture (a private account, a deleted post, Instagram
// serving the login wall anyway) — the caller falls back to a plain link block
// rather than failing the add.
export async function fetchInstagramMeta(
  url: string,
): Promise<(InstagramMeta & { imageUrl: string }) | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": CRAWLER_UA, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const meta = parseInstagramMeta(await res.text(), res.url || url);
  // The picture is the whole block for a post and the subject of an account
  // card, so a page without one is worse than the link block we'd fall back to.
  return meta?.imageUrl ? { ...meta, imageUrl: meta.imageUrl } : null;
}
