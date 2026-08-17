import { expect, test } from "bun:test";

import {
  SCREENSHOT_MAX_ATTEMPTS,
  SCREENSHOT_POLL_MAX_MS,
  nextScreenshotPoll,
  screenshotPollDelayMs,
  whenVisible,
} from "./screenshot-poll";

// A fake `document` for the visibility helper: flip `hidden` and fire.
function visibilityTarget(hidden = false) {
  const listeners = new Set<() => void>();
  return {
    hidden,
    addEventListener(_type: "visibilitychange", listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "visibilitychange", listener: () => void) {
      listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
    fire(nextHidden: boolean) {
      this.hidden = nextHidden;
      for (const listener of [...listeners]) listener();
    },
  };
}

test("the delay doubles from 1s and stops at the 30s ceiling", () => {
  expect(screenshotPollDelayMs(1)).toBe(1_000);
  expect(screenshotPollDelayMs(2)).toBe(2_000);
  expect(screenshotPollDelayMs(3)).toBe(4_000);
  expect(screenshotPollDelayMs(4)).toBe(8_000);
  expect(screenshotPollDelayMs(5)).toBe(16_000);
  expect(screenshotPollDelayMs(6)).toBe(SCREENSHOT_POLL_MAX_MS);
  expect(screenshotPollDelayMs(7)).toBe(SCREENSHOT_POLL_MAX_MS);
  expect(screenshotPollDelayMs(50)).toBe(SCREENSHOT_POLL_MAX_MS);
});

test("five rounds land inside the first fifteen seconds", () => {
  let elapsed = 0;
  for (let attempts = 1; attempts <= 4; attempts++) elapsed += screenshotPollDelayMs(attempts);
  // t = 0, 1, 3, 7, 15 — the window where captures actually resolve. A flat 5s
  // cadence fits three rounds in the same stretch.
  expect(elapsed).toBe(15_000);
});

test("the full attempt budget spans about two and a half minutes", () => {
  let elapsed = 0;
  for (let attempts = 1; attempts < SCREENSHOT_MAX_ATTEMPTS; attempts++) {
    elapsed += screenshotPollDelayMs(attempts);
  }
  expect(elapsed).toBe(151_000);
  // Well under the 300s the flat 5s cadence took, at a sixth of the requests.
  expect(SCREENSHOT_MAX_ATTEMPTS).toBeLessThan(60);
});

test("nothing pending settles the poll", () => {
  expect(nextScreenshotPoll(null, false)).toEqual({ kind: "settled" });
  // Settled beats hidden — there's nothing left to resume for.
  expect(nextScreenshotPoll(null, true)).toEqual({ kind: "settled" });
});

test("a pending URL schedules the next round at its backoff delay", () => {
  expect(nextScreenshotPoll(1, false)).toEqual({ kind: "schedule", delayMs: 1_000 });
  expect(nextScreenshotPoll(5, false)).toEqual({ kind: "schedule", delayMs: 16_000 });
});

test("the freshest pending URL sets the cadence", () => {
  // A page of blocks that just scrolled in is on attempt 1 while an older URL
  // is on attempt 8; the new one gets its fast retry rather than waiting 30s.
  const oldest = 8;
  const freshest = 1;
  expect(nextScreenshotPoll(Math.min(oldest, freshest), false)).toEqual({
    kind: "schedule",
    delayMs: 1_000,
  });
});

test("a hidden document waits instead of scheduling", () => {
  expect(nextScreenshotPoll(3, true)).toEqual({ kind: "await-visible" });
});

test("resuming after hidden picks up at the same attempt count", () => {
  // Being hidden doesn't spend an attempt, so the delay on the way back is the
  // one the round would have used had the tab stayed in front.
  const attempts = 4;
  expect(nextScreenshotPoll(attempts, true)).toEqual({ kind: "await-visible" });
  expect(nextScreenshotPoll(attempts, false)).toEqual({ kind: "schedule", delayMs: 8_000 });
});

test("whenVisible resumes once the document comes back", () => {
  const target = visibilityTarget(true);
  let resumed = 0;
  whenVisible(target, () => resumed++);

  // Still hidden: a spurious event doesn't resume.
  target.fire(true);
  expect(resumed).toBe(0);

  target.fire(false);
  expect(resumed).toBe(1);
});

test("whenVisible unsubscribes so an unmounted board stops resuming", () => {
  const target = visibilityTarget(true);
  let resumed = 0;
  const stop = whenVisible(target, () => resumed++);
  expect(target.listenerCount()).toBe(1);

  stop();
  expect(target.listenerCount()).toBe(0);

  target.fire(false);
  expect(resumed).toBe(0);
});
