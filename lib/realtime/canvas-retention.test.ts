import { expect, test } from "bun:test";

import {
  KEEP_ALL_MS,
  KEEP_DAILY_MS,
  startRetention,
  versionsToPrune,
  type VersionStamp,
} from "./canvas-retention";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// Midday UTC, so whole-day offsets stay mid-day and hour offsets can move a
// version across midnight on purpose.
const NOW = new Date("2026-10-02T12:00:00.000Z");

let nextId = 1;
function v(ageMs: number, opts: { channelId?: number; named?: boolean; id?: number } = {}) {
  return {
    id: opts.id ?? nextId++,
    channelId: opts.channelId ?? 1,
    createdAt: new Date(NOW.getTime() - ageMs),
    named: opts.named ?? false,
  } satisfies VersionStamp;
}

test("every automatic version younger than 7 days is kept", () => {
  const versions = [v(0), v(HOUR), v(HOUR + 1), v(3 * DAY), v(KEEP_ALL_MS - 1)];
  expect(versionsToPrune(versions, NOW)).toEqual([]);
});

test("a version exactly 7 days old enters the one-per-day window", () => {
  // Same UTC day (7 days ago, 12:00 and 11:00): only the later one survives.
  const atBoundary = v(KEEP_ALL_MS);
  const earlierThatDay = v(KEEP_ALL_MS + HOUR);
  const justInside = v(KEEP_ALL_MS - 1);
  expect(versionsToPrune([atBoundary, earlierThatDay, justInside], NOW)).toEqual([
    earlierThatDay.id,
  ]);
});

test("between 7 and 90 days, the latest version of each UTC day survives", () => {
  // 10 days ago at 12:00 UTC, then 11:00, then 13:00 that day, and 23:30 the
  // day before.
  const noon = v(10 * DAY);
  const eleven = v(10 * DAY + HOUR);
  const one = v(10 * DAY - HOUR);
  const prevDayLate = v(10 * DAY + 12.5 * HOUR);
  const doomed = versionsToPrune([noon, eleven, one, prevDayLate], NOW);
  expect(doomed).toEqual([noon.id, eleven.id].sort((a, b) => a - b));
});

test("two versions with the same timestamp keep the higher id", () => {
  const a = v(20 * DAY, { id: 500 });
  const b = v(20 * DAY, { id: 501 });
  expect(versionsToPrune([b, a], NOW)).toEqual([500]);
});

test("days are counted per channel", () => {
  const one = v(15 * DAY, { channelId: 1 });
  const two = v(15 * DAY, { channelId: 2 });
  expect(versionsToPrune([one, two], NOW)).toEqual([]);
});

test("automatic versions 90 days old or older are deleted", () => {
  const justInside = v(KEEP_DAILY_MS - 1);
  const atBoundary = v(KEEP_DAILY_MS);
  const ancient = v(400 * DAY);
  expect(versionsToPrune([justInside, atBoundary, ancient], NOW)).toEqual(
    [atBoundary.id, ancient.id].sort((a, b) => a - b),
  );
});

test("named restore points survive thinning and expiry", () => {
  const named = [
    v(10 * DAY, { named: true }),
    v(10 * DAY + HOUR, { named: true }),
    v(KEEP_DAILY_MS, { named: true }),
    v(1000 * DAY, { named: true }),
  ];
  // An automatic version on the same day as the named ones is still the day's
  // only automatic survivor: named points don't count against it.
  const auto = v(10 * DAY + 2 * HOUR);
  expect(versionsToPrune([...named, auto], NOW)).toEqual([]);
});

test("pruning is stable: a second pass over the survivors deletes nothing", () => {
  const versions: VersionStamp[] = [];
  for (let h = 0; h < 120 * 24; h += 5) versions.push(v(h * HOUR));
  const doomed = new Set(versionsToPrune(versions, NOW));
  const survivors = versions.filter((x) => !doomed.has(x.id));
  expect(versionsToPrune(survivors, NOW)).toEqual([]);
  // 7 days of every version (one every 5 hours), then about one a day to 90.
  const recent = survivors.filter((x) => NOW.getTime() - x.createdAt.getTime() < KEEP_ALL_MS);
  expect(recent.length).toBe(Math.ceil((7 * 24) / 5));
  expect(survivors.length - recent.length).toBeGreaterThanOrEqual(82);
  expect(survivors.length - recent.length).toBeLessThanOrEqual(84);
});

test("startRetention runs at once, deletes what the policy returns, and stops", async () => {
  const old = v(30 * DAY);
  const older = v(30 * DAY + HOUR);
  const cutoffs: Date[] = [];
  const deleted: number[][] = [];
  const retention = startRetention(
    {
      automaticVersionsBefore: async (cutoff) => {
        cutoffs.push(cutoff);
        return [old, older];
      },
      deleteVersions: async (ids) => {
        deleted.push(ids);
      },
    },
    { now: () => NOW, intervalMs: 60_000 },
  );
  try {
    // The immediate run is in flight; run() joins it rather than starting another.
    expect(await retention.run()).toBe(1);
    expect(cutoffs).toEqual([new Date(NOW.getTime() - KEEP_ALL_MS)]);
    expect(deleted).toEqual([[older.id]]);
  } finally {
    retention.stop();
  }
});
