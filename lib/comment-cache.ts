// Per-block cache for comment threads, so stepping through a channel with the
// arrow keys doesn't refetch a thread that was on screen a second ago. The
// modal keys its body by block id, so every step remounts the panel; without
// this each remount starts from "Loading…" and pays a fresh authorization pass
// plus the thread query.
//
// Stale-while-revalidate: `peek` hands back the last known thread so the panel
// paints immediately, and `fetch` refreshes underneath, so a comment posted
// from another session still shows up within one view. Requests in flight are
// shared by block id, so a warm already running is reused instead of
// duplicated by the mount it was warming, and an entry younger than the
// freshness window skips the request entirely.
//
// React-free, and the caller passes the fetcher in rather than this module
// importing a server action, so it unit-tests as a plain module — the same
// split as lib/prefetch.ts and components/block-prefetch.ts.

import type { Comment } from "@/lib/colosseum/comment";

export type CommentFetcher = (columnId: number) => Promise<Comment[]>;

// How long a stored thread counts as current. Long enough that a warm which
// resolves just before the viewer arrives isn't immediately refetched by the
// mount it was warming — otherwise warming doubles the requests instead of
// removing them. Short enough that a comment posted elsewhere lands on the
// next view rather than the next page load.
export const COMMENTS_FRESH_MS = 15_000;

// Most threads to retain. Scrolling a large channel and opening blocks as you
// go would otherwise keep one array per block visited for the whole session.
export const COMMENTS_CACHE_LIMIT = 64;

type Entry = { comments: Comment[]; storedAt: number };

export type CommentCache = {
  // The last known thread for this block, stale or not, or null if none.
  peek(columnId: number): Comment[] | null;
  // The thread, from cache when fresh, otherwise fetched (sharing an in-flight
  // request for the same block).
  fetch(columnId: number, fetcher: CommentFetcher): Promise<Comment[]>;
  // Replace the stored thread and reset its freshness — used after a post or a
  // delete so reopening the block doesn't flash the pre-mutation thread.
  write(columnId: number, comments: Comment[]): void;
  clear(): void;
};

export function createCommentCache(
  options: { freshMs?: number; limit?: number; now?: () => number } = {},
): CommentCache {
  const freshMs = options.freshMs ?? COMMENTS_FRESH_MS;
  const limit = options.limit ?? COMMENTS_CACHE_LIMIT;
  const now = options.now ?? Date.now;

  // Insertion-ordered, and every access re-inserts, so the first key is always
  // the least recently used one — that's what gets dropped at the bound.
  const entries = new Map<number, Entry>();
  const inFlight = new Map<number, Promise<Comment[]>>();

  const touch = (columnId: number): Entry | undefined => {
    const entry = entries.get(columnId);
    if (!entry) return undefined;
    entries.delete(columnId);
    entries.set(columnId, entry);
    return entry;
  };

  const store = (columnId: number, comments: Comment[]) => {
    entries.delete(columnId);
    entries.set(columnId, { comments, storedAt: now() });
    while (entries.size > limit) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    peek(columnId) {
      return touch(columnId)?.comments ?? null;
    },

    fetch(columnId, fetcher) {
      const entry = touch(columnId);
      if (entry && now() - entry.storedAt < freshMs) {
        return Promise.resolve(entry.comments);
      }

      const running = inFlight.get(columnId);
      if (running) return running;

      // A failed fetch stores nothing: the caller falls back to whatever it
      // already has, and the next mount tries again.
      const request = fetcher(columnId)
        .then((comments) => {
          store(columnId, comments);
          return comments;
        })
        .finally(() => {
          if (inFlight.get(columnId) === request) inFlight.delete(columnId);
        });
      inFlight.set(columnId, request);
      return request;
    },

    write(columnId, comments) {
      store(columnId, comments);
    },

    clear() {
      entries.clear();
      inFlight.clear();
    },
  };
}

// The one cache the app uses. ColumnComments renders on the block permalink
// page as well as in the modal, so this module is evaluated on the server too —
// where module state is shared by every request the process handles. A thread
// stored during one viewer's render would then be readable by the next, and
// server-rendered into the HTML of someone who may not be allowed to see it.
// So the cache is browser-only: outside the browser reads return null, writes
// are dropped, and `fetchComments` just calls the fetcher, exactly as
// ColumnComments did before this cache existed.
const cache = createCommentCache();

const inBrowser = () => typeof window !== "undefined";

export function peekComments(columnId: number): Comment[] | null {
  return inBrowser() ? cache.peek(columnId) : null;
}

export function fetchComments(columnId: number, fetcher: CommentFetcher): Promise<Comment[]> {
  return inBrowser() ? cache.fetch(columnId, fetcher) : fetcher(columnId);
}

export function writeComments(columnId: number, comments: Comment[]): void {
  if (inBrowser()) cache.write(columnId, comments);
}
