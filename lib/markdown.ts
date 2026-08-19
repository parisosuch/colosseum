import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

// Bound on the memo below. Entries are capped two ways because block sizes vary
// by orders of magnitude: a count, so a channel of tiny notes can't fill it with
// entries, and a character budget, so a handful of very long blocks can't hold
// megabytes of HTML. 2M chars is ~4 MB of UTF-16 — small enough for a
// self-hosted container, and for the one place this module ships to a browser
// (the block modal's draft preview, loaded on demand).
export const MARKDOWN_CACHE_MAX_ENTRIES = 500;
export const MARKDOWN_CACHE_MAX_CHARS = 2_000_000;

// Content-keyed memo in front of the render. renderMarkdown is pure — the same
// markdown always yields the same sanitized HTML — so keying on the source text
// is safe for every caller, and stale entries are impossible: editing a block's
// text changes the key. Insertion order is the LRU order (a hit re-inserts), so
// eviction drops the least recently used entry first.
//
// Process-local by design. It is a CPU cache, not a correctness mechanism, so a
// second server process just renders once itself, and a restart costs one
// render per block.
const cache = new Map<string, string>();
let cachedChars = 0;
let hits = 0;
let misses = 0;

function remember(md: string, html: string): void {
  const size = md.length + html.length;
  // A single block bigger than the whole budget would evict everything else and
  // still not fit; leave the cache alone and let it re-render.
  if (size > MARKDOWN_CACHE_MAX_CHARS) return;
  cache.set(md, html);
  cachedChars += size;
  while (cache.size > MARKDOWN_CACHE_MAX_ENTRIES || cachedChars > MARKDOWN_CACHE_MAX_CHARS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const evicted = cache.get(oldest.value)!;
    cache.delete(oldest.value);
    cachedChars -= oldest.value.length + evicted.length;
  }
}

// Cache state, for tests and for anything that wants to report on it.
export function markdownCacheStats(): {
  entries: number;
  chars: number;
  hits: number;
  misses: number;
} {
  return { entries: cache.size, chars: cachedChars, hits, misses };
}

// Drop every memoized render. Only tests need this — the cache is otherwise
// self-bounding and can't go stale.
export function resetMarkdownCache(): void {
  cache.clear();
  cachedChars = 0;
  hits = 0;
  misses = 0;
}

// Render user-supplied markdown to sanitized HTML, memoized on the source text.
// Every caller goes through here, so a block that several requests fetch — or
// that one request fetches for several viewers — is parsed and sanitized once.
export function renderMarkdown(md: string): string {
  const hit = cache.get(md);
  if (hit !== undefined) {
    hits++;
    // Re-insert to move it to the most-recently-used end of the Map.
    cache.delete(md);
    cache.set(md, hit);
    return hit;
  }
  misses++;
  const html = render(md);
  remember(md, html);
  return html;
}

// The render itself. marked builds the HTML; sanitize-html then strips anything
// unsafe (scripts, event handlers, javascript: URLs) — this is user input,
// unlike the trusted checked-in docs the developers page renders unsanitized.
// sanitize-html is pure JS (no DOM / jsdom), so it bundles for `next build`
// where isomorphic-dompurify did not.
function render(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "a",
      "ul",
      "ol",
      "li",
      "blockquote",
      "code",
      "pre",
      "strong",
      "em",
      "del",
      "hr",
      "br",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title"],
      code: ["class"],
    },
    // Default allowedSchemes (http, https, ftp, mailto) drop javascript: URLs.
  });
}
