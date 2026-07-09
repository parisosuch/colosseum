// Pure mention parsing — no database access, so client components can import it
// without pulling the server-only Drizzle client into their bundle.
//
// Splits a comment body into text and `@handle` mention segments for rendering.
// Handles match the shape enforced in ./handle (lowercase letters, numbers,
// hyphens, underscores; 3–30 chars). The leading `@` must not follow a word
// character, so emails like "me@gmail.com" are never treated as a mention.
//
// ponytail: purely presentational for now — a mention isn't verified to be a
// real user, and nothing is persisted. When notifications land, resolve each
// segment's `handle` to a user id at comment-create time and store the links.

import { HANDLE_MAX_LENGTH, HANDLE_MIN_LENGTH } from "./handle";

export type MentionSegment =
  | { type: "text"; start: number; value: string }
  | { type: "mention"; start: number; handle: string; raw: string };

const MENTION_RE = new RegExp(
  `(?<![\\w@])@([a-z0-9_-]{${HANDLE_MIN_LENGTH},${HANDLE_MAX_LENGTH}})`,
  "gi",
);

// The mention being typed at the caret, for the composer's autocomplete: the
// `@…` fragment immediately before `caret`, or null when the caret isn't inside
// one. `start` is the index of the `@`. `query` can be "" (just typed `@`).
const ACTIVE_MENTION_RE = new RegExp(`(?<![\\w@])@([a-z0-9_-]{0,${HANDLE_MAX_LENGTH}})$`, "i");

export function activeMention(
  value: string,
  caret: number,
): { query: string; start: number } | null {
  const m = value.slice(0, caret).match(ACTIVE_MENTION_RE);
  if (!m) return null;
  const query = m[1];
  return { query, start: caret - query.length - 1 };
}

export function parseMentions(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const start = m.index ?? 0;
    if (start > last) {
      segments.push({ type: "text", start: last, value: body.slice(last, start) });
    }
    segments.push({ type: "mention", start, handle: m[1].toLowerCase(), raw: m[0] });
    last = start + m[0].length;
  }
  if (last < body.length) {
    segments.push({ type: "text", start: last, value: body.slice(last) });
  }
  return segments;
}
