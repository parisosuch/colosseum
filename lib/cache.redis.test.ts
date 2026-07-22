import { beforeAll, expect, test } from "bun:test";

import { cached, cacheKeys, invalidate } from "./cache";

// Enabled-path tests: they exercise the real Redis integration (miss, hit,
// invalidate, TTL expiry, negative caching). They run only when REDIS_URL is
// set — CI provides a redis service, and locally you can point at a throwaway
// container (`docker run -p 6379:6379 redis:7-alpine`). Without REDIS_URL the
// whole file skips, so the default `bun test` stays Redis-free (that path is
// covered by cache.test.ts).

const REDIS = !!process.env.REDIS_URL;
const redisTest = REDIS ? test : test.skip;

// The client connects in the background, so the first read after boot can land
// before the socket is up. Poll until the cache actually serves a hit so the
// assertions below aren't racing the connection.
async function waitCacheOnline(timeoutMs = 5000): Promise<void> {
  const key = "cache:probe:online";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await invalidate(key);
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return 1;
    };
    await cached(key, 30, fn); // populate (miss)
    await cached(key, 30, fn); // hit if the cache is online
    if (calls === 1) {
      await invalidate(key);
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("redis cache did not come online within timeout");
}

beforeAll(async () => {
  if (REDIS) await waitCacheOnline();
});

redisTest("serves the second call from cache, and recomputes after invalidate", async () => {
  const key = cacheKeys.channel(987654);
  await invalidate(key);

  let calls = 0;
  const fn = async () => {
    calls += 1;
    return { n: calls };
  };

  const first = await cached(key, 60, fn); // miss → compute
  const second = await cached(key, 60, fn); // hit → cached
  expect(first).toEqual({ n: 1 });
  expect(second).toEqual({ n: 1 });
  expect(calls).toBe(1);

  await invalidate(key);
  const third = await cached(key, 60, fn); // miss again → recompute
  expect(third).toEqual({ n: 2 });
  expect(calls).toBe(2);

  await invalidate(key);
});

redisTest("caches negative lookups (null) rather than recomputing them", async () => {
  const key = "cache:probe:null";
  await invalidate(key);

  let calls = 0;
  const fn = async () => {
    calls += 1;
    return null;
  };

  expect(await cached(key, 60, fn)).toBeNull();
  expect(await cached(key, 60, fn)).toBeNull();
  expect(calls).toBe(1); // the null was cached, not recomputed

  await invalidate(key);
});

redisTest("expires an entry after its TTL", async () => {
  const key = "cache:probe:ttl";
  await invalidate(key);

  let calls = 0;
  const fn = async () => {
    calls += 1;
    return calls;
  };

  await cached(key, 1, fn); // 1s TTL, miss
  await cached(key, 1, fn); // hit
  expect(calls).toBe(1);

  await new Promise((r) => setTimeout(r, 1200)); // let it expire
  await cached(key, 1, fn); // miss again
  expect(calls).toBe(2);

  await invalidate(key);
});

redisTest("invalidate() of a missing key is a harmless no-op", async () => {
  await expect(invalidate("cache:probe:never-set")).resolves.toBeUndefined();
});
