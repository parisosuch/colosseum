import { afterEach, beforeEach, expect, test } from "bun:test";

import { cached, cacheKeys, invalidate } from "./cache";

// These tests exercise the disabled path (no REDIS_URL), which is how the app
// runs in CI and by default. The cache must be a transparent passthrough: it
// always computes via the source function and never throws.

const savedUrl = process.env.REDIS_URL;

beforeEach(() => {
  delete process.env.REDIS_URL;
});

afterEach(() => {
  if (savedUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = savedUrl;
});

test("cached() computes via the source function when caching is disabled", async () => {
  let calls = 0;
  const compute = async () => {
    calls += 1;
    return { value: 42 };
  };

  const a = await cached("k", 60, compute);
  const b = await cached("k", 60, compute);

  expect(a).toEqual({ value: 42 });
  expect(b).toEqual({ value: 42 });
  // Disabled: no memoisation, so the source runs every time (nothing cached).
  expect(calls).toBe(2);
});

test("cached() propagates the source function's return value, including null", async () => {
  expect(await cached("k", 60, async () => null)).toBeNull();
  expect(await cached("k", 60, async () => [1, 2, 3])).toEqual([1, 2, 3]);
});

test("invalidate() is a no-op that never throws when caching is disabled", async () => {
  await expect(invalidate(cacheKeys.channel(1))).resolves.toBeUndefined();
  await expect(invalidate()).resolves.toBeUndefined();
});

test("cacheKeys are stable and namespaced", () => {
  expect(cacheKeys.channel(7)).toBe("channel:7");
  expect(cacheKeys.userPublicChannels("u1")).toBe("user-public-channels:u1");
  expect(cacheKeys.userChannels("u1")).toBe("user-channels:u1");
});
