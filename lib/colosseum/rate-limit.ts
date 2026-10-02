// In-memory fixed-window rate limiter for the REST API, keyed by token owner.
// Every /api/v1/* request routes through authenticateApiToken, which calls this
// once the token resolves — so a single token can't spam the API.
//
// ponytail: per-process Map, no cross-instance sharing — the same posture as the
// media route's "single-container deploy" note. Swap for Redis (or Upstash) if
// the deploy ever runs multiple instances. The map holds one entry per distinct
// caller; bounded by user count at the self-hosted scale this targets.

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

// Requests allowed per window per user, and the window length (ms). Read per
// call so an operator can retune limits at runtime without a rebuild.
// `API_RATE_LIMIT=0` (or blank) disables limiting entirely.
function config(): { limit: number; windowMs: number } {
  const raw = process.env.API_RATE_LIMIT;
  return {
    limit: raw !== undefined && raw !== "" ? Number(raw) : 100,
    windowMs: Number(process.env.API_RATE_WINDOW_MS) || 60_000,
  };
}

// `now` is injectable so the window logic is testable without mocking the clock.
export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
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
}
