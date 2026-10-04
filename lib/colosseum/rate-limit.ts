// In-memory fixed-window rate limiters. The REST API's is keyed by token owner:
// every /api/v1/* request routes through authenticateApiToken, which calls
// checkRateLimit once the token resolves, so a single token can't spam the API.
// Other writes that fan out (starting a canvas thread notifies a channel's
// whole roster) make their own with createRateLimiter.
//
// ponytail: per-process Map, no cross-instance sharing — the same posture as the
// media route's "single-container deploy" note. Swap for Redis (or Upstash) if
// the deploy ever runs multiple instances. The map holds one entry per distinct
// caller; bounded by user count at the self-hosted scale this targets.

type Window = { count: number; resetAt: number };

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export type RateLimitConfig = { limit: number; windowMs: number };

export type RateLimiter = {
  // `now` is injectable so the window logic is testable without mocking the clock.
  check(key: string, now?: number): RateLimitResult;
};

// A limiter with its own windows. `config` is read per call, so a limit taken
// from the environment can be retuned at runtime; a limit of 0 (or anything
// not a positive number) disables it.
export function createRateLimiter(config: () => RateLimitConfig): RateLimiter {
  const windows = new Map<string, Window>();
  return {
    check(key, now = Date.now()) {
      const { limit, windowMs } = config();
      if (!Number.isFinite(limit) || limit <= 0) {
        return { ok: true };
      }
      const win = windows.get(key);
      if (!win || now >= win.resetAt) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true };
      }
      if (win.count >= limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((win.resetAt - now) / 1000)) };
      }
      win.count += 1;
      return { ok: true };
    },
  };
}

// Requests allowed per window per user, and the window length (ms).
// `API_RATE_LIMIT=0` (or blank) disables limiting entirely.
function apiConfig(): RateLimitConfig {
  const raw = process.env.API_RATE_LIMIT;
  return {
    limit: raw !== undefined && raw !== "" ? Number(raw) : 100,
    windowMs: Number(process.env.API_RATE_WINDOW_MS) || 60_000,
  };
}

const api = createRateLimiter(apiConfig);

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  return api.check(key, now);
}
