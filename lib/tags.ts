// What a tag may contain, in one place. The tag editor sanitizes as you type
// and the API sanitizes what a client sends, and the two have to agree: the
// board filters tags with `tags @> ARRAY[tag]`, an exact array match, so a tag
// written through the API in a shape the editor can't produce would filter to
// nothing and could never be removed from the pill UI either.
//
// No import of the data layer here — `lib/colosseum/*` is server-only, and the
// tag editor is a client component.

// Alphanumeric with dashes: spaces become `-`, anything else is dropped, and
// runs of dashes collapse so "a  b" is "a-b" rather than "a--b". Safe to run on
// a partial value mid-type, which is why the leading/trailing trim is separate.
export function sanitizeTag(value: string): string {
  return value
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-");
}

// A finished tag: sanitized, with the dashes trimmed off either end. Empty when
// nothing survives, which callers drop.
export function normalizeTag(value: string): string {
  return sanitizeTag(value).replace(/^-+|-+$/g, "");
}

// A whole tag list as it should be stored: each one normalized, empties
// dropped, duplicates removed keeping first position. Non-string entries are
// ignored rather than stringified, so a client sending `[1, null]` gets no tags
// instead of "1" and "null".
export function normalizeTags(values: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = normalizeTag(value);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}
