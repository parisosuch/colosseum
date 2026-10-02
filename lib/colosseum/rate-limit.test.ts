import { afterAll, beforeAll, expect, test } from "bun:test";

import { checkRateLimit } from "./rate-limit";

// Small deterministic window so the test doesn't churn 100 calls.
const prevLimit = process.env.API_RATE_LIMIT;
const prevWindow = process.env.API_RATE_WINDOW_MS;
beforeAll(() => {
  process.env.API_RATE_LIMIT = "3";
  process.env.API_RATE_WINDOW_MS = "1000";
});
afterAll(() => {
  process.env.API_RATE_LIMIT = prevLimit;
  process.env.API_RATE_WINDOW_MS = prevWindow;
});

test("allows up to the limit, then blocks with a retry-after", () => {
  const now = 1_000;
  expect(checkRateLimit("user-a", now).ok).toBe(true);
  expect(checkRateLimit("user-a", now).ok).toBe(true);
  expect(checkRateLimit("user-a", now).ok).toBe(true);
  const blocked = checkRateLimit("user-a", now);
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) expect(blocked.retryAfterSec).toBe(1);
});

test("window resets after it elapses", () => {
  const now = 5_000;
  for (let i = 0; i < 3; i++) checkRateLimit("user-b", now);
  expect(checkRateLimit("user-b", now).ok).toBe(false);
  // Next window (>= resetAt) starts fresh.
  expect(checkRateLimit("user-b", now + 1000).ok).toBe(true);
});

test("keys are independent", () => {
  const now = 9_000;
  for (let i = 0; i < 3; i++) checkRateLimit("user-c", now);
  expect(checkRateLimit("user-c", now).ok).toBe(false);
  expect(checkRateLimit("user-d", now).ok).toBe(true);
});

test("limit of 0 disables limiting", () => {
  process.env.API_RATE_LIMIT = "0";
  const now = 20_000;
  for (let i = 0; i < 50; i++) expect(checkRateLimit("user-e", now).ok).toBe(true);
  process.env.API_RATE_LIMIT = "3";
});
