import { clsx, type ClassValue } from "clsx";
import { TLDs } from "global-tld-list";
import { twMerge } from "tailwind-merge";
import { parse } from "tldts";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// A twitter.com / x.com status URL → its snowflake id, or null for anything
// else. Pure string parsing (no server-only deps) so client components can
// classify a pasted URL as a tweet.
export function tweetIdFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host !== "twitter.com" && host !== "x.com" && host !== "mobile.twitter.com") {
    return null;
  }
  const m = /^\/[^/]+\/status\/(\d+)/.exec(u.pathname);
  return m?.[1] ?? null;
}

export function isTweetUrl(url: string): boolean {
  return tweetIdFromUrl(url) !== null;
}

// A YouTube URL → its 11-char video id, or null for anything else. Handles
// watch?v=, youtu.be/, /shorts/, and /embed/ forms. Pure string parsing (no
// server-only deps) so client components can classify a pasted URL as a video.
export function youtubeIdFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  const isId = (s: string | undefined | null): string | null =>
    s && /^[\w-]{11}$/.test(s) ? s : null;
  if (host === "youtu.be") {
    return isId(u.pathname.slice(1));
  }
  if (host === "youtube.com") {
    if (u.pathname === "/watch") return isId(u.searchParams.get("v"));
    const m = /^\/(?:shorts|embed)\/([\w-]{11})/.exec(u.pathname);
    return isId(m?.[1]);
  }
  return null;
}

export function isYouTubeUrl(url: string): boolean {
  return youtubeIdFromUrl(url) !== null;
}

// The tabs a channel URL can carry after its identifier. Anything else after
// the identifier is some other kind of page, not the channel itself.
const YOUTUBE_CHANNEL_TABS = new Set([
  "featured",
  "videos",
  "shorts",
  "streams",
  "live",
  "playlists",
  "podcasts",
  "releases",
  "courses",
  "community",
  "posts",
  "channels",
  "store",
  "about",
]);

// A YouTube channel URL → the channel's canonical URL and the label it goes by
// (`@syntaxfm`, or the id/name for the older forms), or null for anything else.
// Handles /@handle, /channel/UC…, /c/name, and /user/name, each with an optional
// tab (/videos, /streams, …) — a channel is the same channel whichever tab was
// copied, so they all normalize to its root. Video URLs never match: those are
// /watch, /shorts/<id>, /embed/<id>, and youtu.be, which youtubeIdFromUrl owns.
// Pure string parsing (no server-only deps) so client components can classify a
// pasted URL as a channel.
export function youtubeChannelRef(url: string): { label: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (u.hostname.replace(/^(www\.|m\.)/, "") !== "youtube.com") return null;

  const [first, second, third] = u.pathname.split("/").filter(Boolean);
  if (!first) return null;

  const root = (path: string, label: string, tab: string | undefined) =>
    !tab || YOUTUBE_CHANNEL_TABS.has(tab)
      ? { label, url: `https://www.youtube.com/${path}` }
      : null;

  if (first.startsWith("@") && first.length > 1) {
    return root(first, first, second);
  }
  if ((first === "channel" || first === "c" || first === "user") && second) {
    return root(`${first}/${second}`, second, third);
  }
  return null;
}

export function isYouTubeChannelUrl(url: string): boolean {
  return youtubeChannelRef(url) !== null;
}

// The embeddable content types Spotify's iframe player supports.
const SPOTIFY_TYPES = ["track", "album", "playlist", "artist", "episode", "show"];

// An open.spotify.com URL → its `{ type, id }`, or null for anything else.
// Handles an optional `/intl-xx` locale prefix and any `?si=` query. Pure string
// parsing (no server-only deps) so client components can classify a pasted URL.
export function spotifyEmbedRef(url: string): { type: string; id: string } | null {
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (u.hostname.replace(/^www\./, "") !== "open.spotify.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const seg = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
  const [type, id] = seg;
  if (!type || !id || !SPOTIFY_TYPES.includes(type) || !/^[A-Za-z0-9]+$/.test(id)) {
    return null;
  }
  return { type, id };
}

export function isSpotifyUrl(url: string): boolean {
  return spotifyEmbedRef(url) !== null;
}

// Reserved github.com paths that look like an account but aren't one, so
// /features or /pricing stays a plain URL block instead of becoming a broken
// profile card.
const GITHUB_RESERVED = new Set([
  "about",
  "apps",
  "collections",
  "contact",
  "customer-stories",
  "enterprise",
  "events",
  "explore",
  "features",
  "issues",
  "login",
  "marketplace",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "readme",
  "search",
  "security",
  "settings",
  "sponsors",
  "topics",
  "trending",
]);

// A github.com URL → the repo or account it points at, or null for anything
// else. `/owner` is an account, `/owner/repo` is a repo; deeper paths resolve to
// the repo that contains them, so a link to a file or a release still makes a
// repo card. Pure string parsing (no server-only deps) so client components can
// classify a pasted URL.
export function githubRef(
  url: string,
):
  | { kind: "repo"; owner: string; repo: string; url: string }
  | { kind: "account"; owner: string; url: string }
  | null {
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (u.hostname.replace(/^www\./, "") !== "github.com") return null;

  const [owner, repo] = u.pathname.split("/").filter(Boolean);
  // GitHub's own rules: names are alphanumeric with hyphens (and dots/underscores
  // for repos), so anything else is a path we don't understand.
  if (!owner || !/^[A-Za-z0-9-]+$/.test(owner) || GITHUB_RESERVED.has(owner.toLowerCase())) {
    return null;
  }
  if (!repo) {
    return { kind: "account", owner, url: `https://github.com/${owner}` };
  }
  const name = repo.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return { kind: "repo", owner, repo: name, url: `https://github.com/${owner}/${name}` };
}

export function isGitHubUrl(url: string): boolean {
  return githubRef(url) !== null;
}

// Instagram paths that look like a username but aren't an account, so /explore
// or the login screen stays a plain URL block instead of becoming a card for a
// profile that doesn't exist.
const INSTAGRAM_RESERVED = new Set([
  "about",
  "accounts",
  "ajax",
  "api",
  "challenge",
  "developer",
  "direct",
  "explore",
  "graphql",
  "help",
  "legal",
  "locations",
  "oauth",
  "press",
  "privacy",
  "session",
  "sitemap",
  "stories",
  "terms",
  "web",
]);

// The path segments that introduce a post's shortcode. `reels` is both a post
// form (/reels/<code>) and a profile tab (/<user>/reels), which its position
// tells apart.
const INSTAGRAM_POST_SEGMENTS = new Set(["p", "reel", "reels", "tv"]);

// An instagram.com URL → the post or account it points at, or null for anything
// else (a story, an explore page, the login screen). `/p/<code>`, `/reel/<code>`
// and `/tv/<code>` are posts, with or without the owner's username in front of
// them; `/<username>` is an account, whichever profile tab was copied. Pure
// string parsing (no server-only deps) so client components can classify a
// pasted URL — and so the renderer can read a stored block's kind back off its
// canonical URL instead of the block having to record it.
export function instagramRef(
  url: string,
):
  | { kind: "post"; shortcode: string; username: string | null; url: string }
  | { kind: "account"; username: string; url: string }
  | null {
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (u.hostname.replace(/^(www\.|m\.)/, "") !== "instagram.com") return null;

  const parts = u.pathname.split("/").filter(Boolean);
  // The app's share sheet hands out /share/… links that redirect to the real
  // post; dropping the prefix leaves a form we recognize (and the fetch follows
  // the redirect either way, so the canonical URL is what gets stored).
  if (parts[0] === "share") parts.shift();

  const [first, second, third] = parts;
  if (!first) return null;

  // Instagram's own rules: usernames are alphanumeric with dots and
  // underscores, shortcodes are base64url.
  const isUsername = (s: string) =>
    /^[A-Za-z0-9._]{1,30}$/.test(s) && !INSTAGRAM_RESERVED.has(s.toLowerCase());
  const isShortcode = (s: string) => /^[A-Za-z0-9_-]{5,}$/.test(s);
  const post = (username: string | null, segment: string, shortcode: string) => ({
    kind: "post" as const,
    shortcode,
    username,
    url: username
      ? `https://www.instagram.com/${username}/${segment}/${shortcode}/`
      : `https://www.instagram.com/${segment}/${shortcode}/`,
  });

  if (INSTAGRAM_POST_SEGMENTS.has(first)) {
    return second && isShortcode(second) ? post(null, first, second) : null;
  }
  if (!isUsername(first)) return null;
  if (second && INSTAGRAM_POST_SEGMENTS.has(second) && third && isShortcode(third)) {
    return post(first, second, third);
  }
  return { kind: "account", username: first, url: `https://www.instagram.com/${first}/` };
}

export function isInstagramUrl(url: string): boolean {
  return instagramRef(url) !== null;
}

// What kind of block a URL should become. One ordered decision, shared by the
// channel input (which dispatches straight to the matching action, so it can
// name the block in its toast) and by uploadURLColumnAction, which every other
// path goes through. Keeping it in one place is what stops a link pasted into
// the quick-add drawer becoming a different kind of block from the same link
// pasted into the channel input.
//
// Order matters where a URL could match twice: a YouTube channel URL is checked
// before a video, since /@handle/videos is a channel page and not a video.
export type UrlBlockKind =
  | "tweet"
  | "youtube_channel"
  | "youtube"
  | "spotify"
  | "github"
  | "instagram"
  | "image"
  | "url";

export function urlBlockKind(url: string): UrlBlockKind {
  if (isTweetUrl(url)) return "tweet";
  if (isYouTubeChannelUrl(url)) return "youtube_channel";
  if (isYouTubeUrl(url)) return "youtube";
  if (isSpotifyUrl(url)) return "spotify";
  if (isGitHubUrl(url)) return "github";
  if (isInstagramUrl(url)) return "instagram";
  if (isImageUrl(url)) return "image";
  return "url";
}

// The path extensions that map onto ALLOWED_IMAGE_TYPES (lib/colosseum/blob.ts).
// SVG is deliberately absent: it isn't an allowed upload type either.
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif"];

// Does this URL point straight at an image file? Judged by the path extension
// alone — pure string parsing (no server-only deps, no network) so client
// components can classify a pasted URL before submitting it. The server still
// verifies the real bytes when it fetches them, and falls back to a plain link
// block if the URL turns out not to be a usable image.
export function isImageUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return false;
  }
  const ext = u.pathname.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.includes(ext);
}

export function isURL(text: string): boolean {
  let url: URL;
  try {
    const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(text) ? text : `http://${text}`;
    url = new URL(candidate);
  } catch {
    return false;
  }

  const hostname = url.hostname; // e.g. "foo.example.com"

  // Use tldts to parse the hostname / URL
  const info = parse(hostname, { allowPrivateDomains: false });

  if (info.isIp) {
    return false;
  }

  // If there is no public suffix or domain part, it’s invalid
  if (!info.publicSuffix || !info.domain) {
    return false;
  }

  // Check that the TLD (suffix) is in the global TLD list
  const tld = info.publicSuffix.toLowerCase();
  if (!TLDs.isValid(tld)) {
    return false;
  }

  return true;
}

// A browser "copy image" also drops an HTML fragment on the clipboard whose
// <img> src points at the original image. Returns that http(s) source (so a
// pasted GIF can be fetched at full fidelity instead of the flattened PNG
// snapshot the browser also puts in clipboardData.files), or null when the
// fragment has no usable absolute image URL.
export function imageSrcFromHtml(html: string): string | null {
  const src = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  return src && /^https?:\/\//i.test(src) ? src : null;
}

// The `<img src>` for a cached website screenshot: the stored object URL with
// `?v=<version>` appended, or null when there's no screenshot. `version` is the
// screenshot's captured_at — the storage object is overwritten in place on
// refresh, so without the token the browser keeps serving the stale bytes.
// Every caller goes through here so the URL is byte-for-byte identical: a
// prefetch only warms the cache entry the renderer later asks for if the two
// strings match exactly.
export function screenshotSrc(
  imageUrl: string | null | undefined,
  version: string | number | null | undefined,
): string | null {
  if (!imageUrl) return null;
  const v = version == null ? "" : String(version);
  return v ? `${imageUrl}?v=${encodeURIComponent(v)}` : imageUrl;
}

// The downsized rendition of a block image: what the grid card renders, and
// what the modal paints behind the full-size image while that loads. The two
// share a cache entry only while the URL is byte-for-byte identical, so the
// card and the modal both build it here rather than each appending `?thumb`
// themselves — the modal's placeholder is then already decoded, at no request.
export function thumbSrc(image: string | null | undefined): string | null {
  return image ? `${image}?thumb` : null;
}

// The width every thumbnail is downsized to (grid cards render a few hundred px
// wide, so 600 covers 2x DPR). Lives here rather than beside the sharp pipeline
// that applies it because the browser needs it too: the resize never enlarges,
// so a thumbnail narrower than this is the source at its own size, which is how
// the modal knows whether its placeholder can be blown up to fill the panel.
export const THUMB_MAX_WIDTH = 600;

// A block's card art is drawn by two renderers — the interactive grid card
// (column.tsx) and the server-rendered preview (column-preview.tsx) — plus the
// per-type components both delegate to. They round and pad the same block, so
// the values live here instead of being spelled out in each: a grid mixing the
// two used to show the same block at two different corner radii.
export const CARD_MEDIA_RADIUS = "rounded-lg";
export const CARD_TEXT_CLASS = "h-full w-full overflow-hidden p-2";
// Body size for a text block's markdown inside a card, at card scale.
export const CARD_TEXT_SIZE = "text-xs";

// The play/type badge over a card's art. A corner marker, not a control: the
// card's own click opens the block modal (which holds the real player), and a
// centred badge over the art reads as a play button that does something else.
export const CARD_BADGE_CLASS =
  "pointer-events-none absolute bottom-1 left-1 flex items-center justify-center rounded-full bg-black/60 p-1.5 text-white";

// Escapes ilike wildcards so a literal `%`/`_` in a search term isn't treated
// as one, and strips the characters PostgREST uses to delimit an `.or(...)`
// filter so a search term can't break out of it.
export function sanitizeSearch(term: string): string {
  return term
    .replace(/[%_]/g, (m) => `\\${m}`)
    .replace(/[(),]/g, " ")
    .trim();
}

// A PostgREST `.or(...)` fragment matching rows whose `tags` array contains the
// search term exactly. Drops `"`/`\` so the term can't break out of the
// {"..."} array literal; the sanitizeSearch `%`-escaping round-trips back to a
// literal `%`. Exact-match only — a search for "des" won't hit tag "design".
// ponytail: exact tag match; add a trigram index if partial matching is needed.
export function tagContainsFilter(sanitizedTerm: string): string {
  const t = sanitizedTerm.replace(/["\\]/g, "").trim();
  return t ? `tags.cs.{"${t}"}` : "";
}

export function timeAgo(date: Date) {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  const intervals: { [key: string]: number } = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  };

  for (const [unit, value] of Object.entries(intervals)) {
    const amount = Math.floor(seconds / value);
    if (amount >= 1) {
      return `${amount} ${unit}${amount > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}
