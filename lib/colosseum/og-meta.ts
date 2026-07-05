// Open Graph / metadata extraction — the fallback when a live headless render
// is blocked or fails. A plain HTML fetch with a browser-like UA often succeeds
// where a full render doesn't (no JS, no automation fingerprint), and the
// og:image it exposes is a preview the site publishes for exactly this purpose.
//
// Deliberately free of DB / server-only imports so the parser stays unit-testable.

// A current desktop Chrome UA, shared with the headless launch so both the
// render and this fallback look like the same ordinary browser.
export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type OgMeta = { imageUrl: string | null; title: string; description: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, "/");
}

// Find a <meta> tag's content by its property/name key, robust to attribute
// order (content can come before or after the key) and quote style.
function metaContent(html: string, keyAttr: "property" | "name", keyVal: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi);
  if (!tags) return null;
  const keyRe = new RegExp(
    `\\b${keyAttr}\\s*=\\s*["']${keyVal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
    "i",
  );
  for (const tag of tags) {
    if (!keyRe.test(tag)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (content) return decodeEntities(content[1].trim());
  }
  return null;
}

function titleTag(html: string): string | null {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1].trim()) : null;
}

// Parse preview metadata out of a page's HTML. `baseUrl` resolves a relative
// og:image to an absolute URL.
export function parseOgMeta(html: string, baseUrl: string): OgMeta {
  const img =
    metaContent(html, "property", "og:image") ??
    metaContent(html, "name", "twitter:image") ??
    metaContent(html, "property", "twitter:image");

  const title = metaContent(html, "property", "og:title") ?? titleTag(html) ?? "";
  const description =
    metaContent(html, "property", "og:description") ??
    metaContent(html, "name", "description") ??
    "";

  let imageUrl: string | null = null;
  if (img) {
    try {
      imageUrl = new URL(img, baseUrl).href;
    } catch {
      imageUrl = null;
    }
  }

  return { imageUrl, title: title.slice(0, 200), description: description.slice(0, 500) };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  return fetch(url, {
    headers: { "User-Agent": DESKTOP_UA, Accept: "text/html,image/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
}

// Fetch a page's HTML, pull its og:image, and download those bytes. Returns
// null when there's no usable preview image. Title/description come along so a
// fallback capture can still pre-fill a block's metadata.
export async function fetchOgFallback(
  url: string,
  timeoutMs: number,
): Promise<{ image: Buffer; title: string; description: string } | null> {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res || !res.ok) return null;

  const html = await res.text().catch(() => "");
  const meta = parseOgMeta(html, res.url || url);
  if (!meta.imageUrl) return null;

  const imgRes = await fetchWithTimeout(meta.imageUrl, timeoutMs);
  if (!imgRes || !imgRes.ok) return null;

  const image = Buffer.from(await imgRes.arrayBuffer());
  if (image.length === 0) return null;

  return { image, title: meta.title, description: meta.description };
}
