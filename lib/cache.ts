import "server-only";

import { logError } from "@/lib/log";

// Optional Redis cache layer in front of hot, stable read queries. It is
// **disabled by default**: unless `REDIS_URL` is set (and `REDIS_CACHE_ENABLED`
// is not "false"), every helper here degrades to calling the source function
// directly, so the app behaves exactly as it did with no cache at all.
//
// The cache is best-effort and can never break a request: any Redis failure —
// unreachable server, timeout, malformed value — is swallowed and treated as a
// miss, falling straight through to Postgres. Correctness comes from explicit
// invalidation on the matching mutations (see channel.ts), backed by a TTL so a
// missed invalidation self-heals within a bounded window.

// The subset of the ioredis client we use, so nothing else imports ioredis.
type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  on(event: "error" | "ready", listener: (err: unknown) => void): unknown;
};

function cacheEnabled(): boolean {
  return !!process.env.REDIS_URL && process.env.REDIS_CACHE_ENABLED !== "false";
}

// Lazily-constructed singleton, memoised on globalThis so hot-reloads in dev
// don't open a new connection per module reload (mirrors lib/db/index.ts). The
// value is a Promise so concurrent callers share one connect. A null resolution
// means "cache unavailable" — callers fall back to the source.
const globalForCache = globalThis as unknown as {
  redisClient?: Promise<RedisLike | null>;
};

function getClient(): Promise<RedisLike | null> {
  if (!cacheEnabled()) return Promise.resolve(null);
  if (!globalForCache.redisClient) {
    globalForCache.redisClient = (async () => {
      try {
        // Dynamic import so ioredis is never loaded (or bundled into the hot
        // path) when the cache is disabled.
        const { default: Redis } = await import("ioredis");
        // Connect in the background (no lazyConnect / no awaited connect) and
        // let ioredis auto-reconnect for the process's lifetime. This is what
        // makes an always-on deployment self-healing: if Redis is briefly
        // unreachable at boot or restarts later, the client reconnects on its
        // own — we never memoise a permanently-dead null. While it's down,
        // `enableOfflineQueue: false` makes commands reject immediately so a
        // read falls straight through to Postgres instead of hanging.
        const client = new Redis(process.env.REDIS_URL!, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 3000,
        });
        // ioredis throws on an 'error' event with no listener; log and swallow
        // (a reconnect is already scheduled). The at-most-once error listener
        // avoids noisy logs during an outage.
        let logged = false;
        client.on("error", (err) => {
          if (logged) return;
          logged = true;
          logError("cache", "redis client error (will keep retrying)", err);
        });
        client.on("ready", () => {
          logged = false;
        });
        return client as unknown as RedisLike;
      } catch (err) {
        logError("cache", "failed to init redis; caching disabled", err);
        return null;
      }
    })();
  }
  return globalForCache.redisClient;
}

// Return the cached value for `key`, or compute it with `fn`, store it under
// `key` with a `ttlSeconds` expiry, and return it. Falls through to `fn()` on
// any cache miss or Redis error.
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const client = await getClient();
  if (!client) return fn();

  try {
    const hit = await client.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch {
    // Redis unreachable or a bad value: skip the cache entirely for this call.
    return fn();
  }

  const value = await fn();
  try {
    await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // A failed write just means the next read recomputes; not fatal.
  }
  return value;
}

// Drop cache entries so the next read recomputes. No-op when caching is off.
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const client = await getClient();
  if (!client) return;
  try {
    await client.del(...keys);
  } catch {
    // Best-effort: a failed delete leaves a stale entry that the TTL still
    // reaps, so the data self-heals within the TTL window.
  }
}

// Central key schema so reads and their invalidations can't drift apart.
export const cacheKeys = {
  channel: (id: number) => `channel:${id}`,
  userPublicChannels: (userId: string) => `user-public-channels:${userId}`,
  userChannels: (userId: string) => `user-channels:${userId}`,
};

// TTLs (seconds). Channel metadata is short so title/access edits surface
// quickly even if an invalidation is missed; the per-user channel lists are
// longer, trading some ordering staleness (they order by last-block-added,
// which block writes don't invalidate) for a high hit rate.
export const cacheTtl = {
  channel: 300, // 5 minutes
  userChannels: 1800, // 30 minutes
};
