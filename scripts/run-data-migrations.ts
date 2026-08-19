// Boot-time runner for the one-shot data migrations in `scripts/data/`. Called
// from entrypoint.sh after `db:migrate:drizzle`, so every schema migration is
// in place before any of these touch the data.
//
//   bun run data:migrate
//
// Safe to run by hand at any time: each migration is skipped once the ledger
// says it converged, so a settled deployment does one SELECT and exits.
//
// Migrations run in filename order. A `required` failure exits non-zero, which
// stops the container rather than serving against data a migration was supposed
// to fix; a best-effort failure is logged and the boot continues.

import { readdir } from "node:fs/promises";
import path from "node:path";

import { type DataMigration, runPendingDataMigrations } from "@/lib/colosseum/data-migration";

const DIR = path.join(import.meta.dir, "data");

// Filename order is the run order, which is why the files are numbered. Reading
// the directory (rather than an index file listing them) means adding a
// migration is one new file and nothing else to remember.
async function load(): Promise<DataMigration[]> {
  const entries = (await readdir(DIR)).filter((f) => f.endsWith(".ts")).sort();
  const migrations: DataMigration[] = [];

  for (const file of entries) {
    const mod = (await import(path.join(DIR, file))) as { default?: DataMigration };
    const migration = mod.default;
    if (!migration?.id || typeof migration.run !== "function") {
      throw new Error(`scripts/data/${file} must default-export a DataMigration`);
    }
    // The id is the ledger key, so a mismatch between it and the filename would
    // make the ledger unreadable next to the directory. Catch it here rather
    // than discovering it when a rename silently re-runs a migration.
    const stem = file.replace(/\.ts$/, "");
    if (migration.id !== stem) {
      throw new Error(`scripts/data/${file} declares id "${migration.id}"; expected "${stem}"`);
    }
    migrations.push(migration);
  }

  return migrations;
}

const migrations = await load();
const outcomes = await runPendingDataMigrations(migrations);

const failed = outcomes.filter((o) => o.status === "failed");
const blocking = failed.filter((o) => migrations.find((m) => m.id === o.id)?.required);

const applied = outcomes.filter((o) => o.status === "applied").length;
const pending = outcomes.filter((o) => o.status === "pending").length;
console.log(
  `data migrations: ${applied} applied, ${pending} still pending, ${failed.length} failed, ${outcomes.length} total.`,
);

if (blocking.length > 0) {
  console.error(`data migrations: ${blocking.map((o) => o.id).join(", ")} failed — not starting.`);
  process.exit(1);
}

process.exit(0);
