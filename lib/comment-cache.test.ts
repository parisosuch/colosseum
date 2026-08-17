import { expect, test } from "bun:test";

import type { Comment } from "./colosseum/comment";
import { createCommentCache, fetchComments, peekComments, writeComments } from "./comment-cache";

const comment = (id: number, column_id = 1): Comment => ({
  id,
  created_at: new Date(id).toISOString(),
  column_id,
  author_id: "user-1",
  body: `comment ${id}`,
  author_handle: "alice",
});

// A fetcher that resolves immediately and counts its calls.
const counting = (result: (columnId: number) => Comment[] = () => []) => {
  const calls: number[] = [];
  const fetcher = (columnId: number) => {
    calls.push(columnId);
    return Promise.resolve(result(columnId));
  };
  return { calls, fetcher };
};

// A fetcher whose promises are resolved by hand, so an in-flight request can be
// observed before it settles.
const deferred = () => {
  const calls: number[] = [];
  const resolvers: ((comments: Comment[]) => void)[] = [];
  const fetcher = (columnId: number) => {
    calls.push(columnId);
    return new Promise<Comment[]>((resolve) => resolvers.push(resolve));
  };
  return { calls, resolvers, fetcher };
};

// A clock the tests advance explicitly, so the freshness window doesn't depend
// on wall time.
const clock = (start = 1_000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

test("peek misses before anything has been fetched", () => {
  const cache = createCommentCache();
  expect(cache.peek(1)).toBeNull();
});

test("a fetched thread is served from peek afterwards", async () => {
  const cache = createCommentCache();
  const { fetcher } = counting(() => [comment(1)]);

  expect(await cache.fetch(7, fetcher)).toEqual([comment(1)]);
  expect(cache.peek(7)).toEqual([comment(1)]);
  // A different block is still a miss.
  expect(cache.peek(8)).toBeNull();
});

test("a fetch inside the freshness window skips the request", async () => {
  const time = clock();
  const cache = createCommentCache({ freshMs: 15_000, now: time.now });
  const { calls, fetcher } = counting(() => [comment(1)]);

  await cache.fetch(7, fetcher);
  time.advance(14_999);
  expect(await cache.fetch(7, fetcher)).toEqual([comment(1)]);
  expect(calls).toEqual([7]);
});

test("a fetch past the freshness window refreshes underneath", async () => {
  const time = clock();
  const cache = createCommentCache({ freshMs: 15_000, now: time.now });
  let round = 0;
  const { calls, fetcher } = counting(() => [comment(++round)]);

  await cache.fetch(7, fetcher);
  time.advance(15_000);

  // Stale-while-revalidate: the old thread is still there to paint with while
  // the refresh runs.
  expect(cache.peek(7)).toEqual([comment(1)]);
  expect(await cache.fetch(7, fetcher)).toEqual([comment(2)]);
  expect(calls).toEqual([7, 7]);
  expect(cache.peek(7)).toEqual([comment(2)]);
});

test("concurrent fetches for one block share a single request", async () => {
  const cache = createCommentCache();
  const { calls, resolvers, fetcher } = deferred();

  const warm = cache.fetch(7, fetcher);
  const mount = cache.fetch(7, fetcher);
  expect(calls).toEqual([7]);

  resolvers[0]([comment(1)]);
  expect(await warm).toEqual([comment(1)]);
  expect(await mount).toEqual([comment(1)]);
});

test("different blocks fetch independently", async () => {
  const cache = createCommentCache();
  const { calls, resolvers, fetcher } = deferred();

  const a = cache.fetch(7, fetcher);
  const b = cache.fetch(8, fetcher);
  expect(calls).toEqual([7, 8]);

  resolvers[0]([comment(1)]);
  resolvers[1]([comment(2)]);
  expect(await a).toEqual([comment(1)]);
  expect(await b).toEqual([comment(2)]);
});

test("a failed fetch stores nothing and lets the next attempt through", async () => {
  const cache = createCommentCache();
  let attempts = 0;
  const fetcher = () => {
    attempts++;
    return attempts === 1 ? Promise.reject(new Error("nope")) : Promise.resolve([comment(1)]);
  };

  await expect(cache.fetch(7, fetcher)).rejects.toThrow("nope");
  expect(cache.peek(7)).toBeNull();
  expect(await cache.fetch(7, fetcher)).toEqual([comment(1)]);
  expect(attempts).toBe(2);
});

test("write-through replaces the thread and resets its freshness", async () => {
  const time = clock();
  const cache = createCommentCache({ freshMs: 15_000, now: time.now });
  const { calls, fetcher } = counting(() => [comment(1)]);

  await cache.fetch(7, fetcher);
  time.advance(20_000);

  // A post writes the thread it just produced, so reopening the block doesn't
  // flash the pre-mutation version…
  cache.write(7, [comment(1), comment(2)]);
  expect(cache.peek(7)).toEqual([comment(1), comment(2)]);
  // …and the just-written thread counts as fresh, so the next mount doesn't
  // immediately refetch it.
  expect(await cache.fetch(7, fetcher)).toEqual([comment(1), comment(2)]);
  expect(calls).toEqual([7]);
});

test("write-through works for a block that was never fetched", () => {
  const cache = createCommentCache();
  cache.write(7, [comment(1)]);
  expect(cache.peek(7)).toEqual([comment(1)]);
});

test("a delete's write-through drops the removed comment", async () => {
  const cache = createCommentCache();
  const { fetcher } = counting(() => [comment(1), comment(2)]);

  await cache.fetch(7, fetcher);
  cache.write(
    7,
    (cache.peek(7) ?? []).filter((c) => c.id !== 1),
  );
  expect(cache.peek(7)).toEqual([comment(2)]);
});

test("retained entries are bounded, dropping the least recently used", () => {
  const cache = createCommentCache({ limit: 3 });

  cache.write(1, [comment(1)]);
  cache.write(2, [comment(2)]);
  cache.write(3, [comment(3)]);
  // Reading block 1 makes block 2 the least recently used.
  expect(cache.peek(1)).toEqual([comment(1)]);

  cache.write(4, [comment(4)]);
  expect(cache.peek(2)).toBeNull();
  expect(cache.peek(1)).toEqual([comment(1)]);
  expect(cache.peek(3)).toEqual([comment(3)]);
  expect(cache.peek(4)).toEqual([comment(4)]);
});

test("clear drops everything", async () => {
  const cache = createCommentCache();
  const { fetcher } = counting(() => [comment(1)]);
  await cache.fetch(7, fetcher);

  cache.clear();
  expect(cache.peek(7)).toBeNull();
});

// The permalink page server-renders ColumnComments, and module state on the
// server is shared across every request the process handles — one viewer's
// thread must never be readable by the next. These tests run without a
// `window`, which is exactly the server's situation.
test("the shared cache does not retain anything outside the browser", async () => {
  expect(typeof window).toBe("undefined");

  writeComments(7, [comment(1)]);
  expect(peekComments(7)).toBeNull();

  const { calls, fetcher } = counting(() => [comment(1)]);
  expect(await fetchComments(7, fetcher)).toEqual([comment(1)]);
  // The fetch went through untouched, and stored nothing for the next request
  // to pick up.
  expect(calls).toEqual([7]);
  expect(peekComments(7)).toBeNull();
  expect(await fetchComments(7, fetcher)).toEqual([comment(1)]);
  expect(calls).toEqual([7, 7]);
});
