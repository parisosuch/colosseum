import "server-only";

import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { dataMigration } from "@/lib/db/schema";
import { logError } from "@/lib/log";

// A one-shot data fix, living in `scripts/data/` and run once per deployment by
// the boot runner. Schema changes belong in `drizzle/`; this is for the data
// they leave behind — backfilling a column a migration added, moving bytes
// between storage backends, and the like.
export type DataMigration = {
  // The filename stem, which is also the ledger key and the sort order:
  // "0002-mark-existing-thumbnails".
  id: string;
  // Whether a failure should stop the boot. A fix the app can't serve correctly
  // without is `true`; anything whose absence only costs performance is `false`
  // and must stay false, or a transient S3 outage turns a slow deployment into
  // a down one.
  required?: boolean;
  // Does the work. Idempotent, always — a crash part-way through leaves no
  // ledger row, so the next boot runs it again from the top.
  //
  // Returning `{ done: false }` means "made progress, but there is more left":
  // no ledger row is written and the next boot picks it up again. That is how a
  // long backfill converges over several boots instead of holding the container
  // off the port, and how a migration whose tooling is missing today can wait
  // for a deployment that has it.
  run: () => Promise<void | { done: boolean }>;
};

export type DataMigrationOutcome = {
  id: string;
  // `applied` wrote a ledger row; `pending` ran without finishing (and will run
  // again); `skipped` was already in the ledger; `failed` threw.
  status: "applied" | "pending" | "skipped" | "failed";
  error?: unknown;
};

// Which of these have already fully converged. One query rather than one per
// migration, and scoped to the ids we were handed so an unknown row left by a
// newer version doesn't matter.
async function appliedIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: dataMigration.id })
    .from(dataMigration)
    .where(inArray(dataMigration.id, ids));
  return new Set(rows.map((r) => r.id));
}

// Runs every migration that hasn't converged yet, in the order given, and
// records each one that finishes.
//
// The ordering guarantee is only against other data migrations: the whole set
// runs after `db:migrate:drizzle`, so a data migration can rely on every schema
// migration being in place, but one that needs to land *between* two schema
// migrations can't be expressed here. That case is deliberately unsupported —
// it would mean interleaving two pipelines with different failure semantics,
// and no fix has needed it.
//
// A `required` failure stops the run: later migrations may depend on it, and
// the caller is expected to exit non-zero so the container doesn't serve. A
// best-effort failure is logged and the run continues.
export async function runPendingDataMigrations(
  migrations: DataMigration[],
  log: (message: string) => void = console.log,
): Promise<DataMigrationOutcome[]> {
  const applied = await appliedIds(migrations.map((m) => m.id));
  const outcomes: DataMigrationOutcome[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      outcomes.push({ id: migration.id, status: "skipped" });
      continue;
    }

    log(`data migration ${migration.id}: running`);
    try {
      const result = await migration.run();
      if (result && result.done === false) {
        // Progress without completion. No row, so it runs again next boot.
        outcomes.push({ id: migration.id, status: "pending" });
        log(`data migration ${migration.id}: more to do, will resume next boot`);
        continue;
      }
      // Written only after run() resolves, which is the whole contract: a crash
      // mid-run leaves no row and the work is retried.
      await db.insert(dataMigration).values({ id: migration.id }).onConflictDoNothing();
      outcomes.push({ id: migration.id, status: "applied" });
      log(`data migration ${migration.id}: done`);
    } catch (error) {
      outcomes.push({ id: migration.id, status: "failed", error });
      logError("data-migration", `${migration.id} failed`, error);
      if (migration.required) {
        // Stop here rather than running later migrations against the state this
        // one was supposed to produce.
        break;
      }
    }
  }

  return outcomes;
}
