// The share-link media route's URL shape, kept free of database imports so the
// export builder (which runs in the browser) can use it too.

const MEDIA_RE = /^(\/api\/media\/[0-9a-f-]{36})(\?.*)?$/;
const SHARED_MEDIA_RE = /^(\/api\/media\/[0-9a-f-]{36})\/s\/[A-Za-z0-9_-]+(\?.*)?$/;

// A block's own media URL, rewritten to the token-scoped route a link holder
// can load (/api/media/<id>/s/<token>). Anything else — an external URL, a
// URL already rewritten — passes through. Callers append `?thumb` after this,
// so the token goes in the path.
export function shareMediaUrl(url: string, token: string): string {
  const match = MEDIA_RE.exec(url);
  return match ? `${match[1]}/s/${token}${match[2] ?? ""}` : url;
}

// The reverse: a share-route media URL back to the plain one. For anything
// that leaves the page, like an export, which shouldn't carry the link's
// credential to wherever the file ends up.
export function stripShareToken(url: string): string {
  const match = SHARED_MEDIA_RE.exec(url);
  return match ? `${match[1]}${match[2] ?? ""}` : url;
}
