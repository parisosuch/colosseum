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
