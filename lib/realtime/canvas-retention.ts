// How long canvas versions live. Every automatic version is kept for a week,
// then thinned to the last one of each day (UTC) until it is 90 days old, then
// deleted. Named restore points never expire.
//
// The thinning runs on a timer inside the app process (server.ts) so a
// self-hosted instance gets it from `docker compose up` alone, with no cron or
// external scheduler. `versionsToPrune` is the whole policy and does no I/O;
// `startRetention` only feeds it rows and deletes what it returns.

const DAY_MS = 24 * 60 * 60 * 1000;

// Versions younger than this are all kept.
export const KEEP_ALL_MS = 7 * DAY_MS;
// Automatic versions this old or older are deleted outright.
export const KEEP_DAILY_MS = 90 * DAY_MS;

export type VersionStamp = {
  id: number;
  channelId: number;
  createdAt: Date;
  // A named restore point. Never pruned.
  named: boolean;
};

// Ids of the versions the policy drops, ascending. A version exactly 7 days
// old has entered the daily window; one exactly 90 days old is gone. Within a
// channel's UTC day the latest version survives (the higher id on a tie), so a
// day's survivor stays the survivor on every later run.
export function versionsToPrune(versions: readonly VersionStamp[], now: Date): number[] {
  const keepAllAfter = now.getTime() - KEEP_ALL_MS;
  const deleteAtOrBefore = now.getTime() - KEEP_DAILY_MS;
  const doomed: number[] = [];
  const dayKeeper = new Map<string, VersionStamp>();

  for (const v of versions) {
    if (v.named) continue;
    const t = v.createdAt.getTime();
    if (t > keepAllAfter) continue;
    if (t <= deleteAtOrBefore) {
      doomed.push(v.id);
      continue;
    }
    const day = `${v.channelId}:${v.createdAt.toISOString().slice(0, 10)}`;
    const kept = dayKeeper.get(day);
    if (!kept) {
      dayKeeper.set(day, v);
    } else if (t > kept.createdAt.getTime() || (t === kept.createdAt.getTime() && v.id > kept.id)) {
      doomed.push(kept.id);
      dayKeeper.set(day, v);
    } else {
      doomed.push(v.id);
    }
  }
  return doomed.sort((a, b) => a - b);
}

export interface RetentionStore {
  // Automatic (unnamed) versions created at or before `cutoff`, every channel.
  automaticVersionsBefore(cutoff: Date): Promise<VersionStamp[]>;
  deleteVersions(ids: number[]): Promise<void>;
}

export type RetentionOptions = {
  intervalMs?: number;
  now?: () => Date;
};

const DELETE_BATCH = 1000;

// Prune once now and then every `intervalMs`. The timer is unref'd so it never
// holds a process open on its own. A run that's still going when the next one
// is due is left to finish rather than doubled up.
export function startRetention(store: RetentionStore, options: RetentionOptions = {}) {
  const { intervalMs = 60 * 60 * 1000, now = () => new Date() } = options;
  let running: Promise<number> | null = null;

  async function prune(): Promise<number> {
    const at = now();
    const candidates = await store.automaticVersionsBefore(new Date(at.getTime() - KEEP_ALL_MS));
    const doomed = versionsToPrune(candidates, at);
    for (let i = 0; i < doomed.length; i += DELETE_BATCH) {
      await store.deleteVersions(doomed.slice(i, i + DELETE_BATCH));
    }
    return doomed.length;
  }

  function run(): Promise<number> {
    running ??= prune().finally(() => {
      running = null;
    });
    return running;
  }

  function tick() {
    run().catch((err) => console.error("[realtime] pruning canvas versions failed", err));
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();

  return {
    // For tests and shutdown: resolves with how many versions went.
    run,
    stop(): void {
      clearInterval(timer);
    },
  };
}
