import { beforeAll, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { dataMigration } from "@/lib/db/schema";
import { seed } from "@/scripts/seed";
import { type DataMigration, runPendingDataMigrations } from "./data-migration";

beforeAll(async () => {
  await seed();
});

// Each test uses its own id namespace so they don't collide through the shared
// ledger table, which `seed()` doesn't clear.
const ids = (test: string, n: number) =>
  Array.from({ length: n }, (_, i) => `test-${test}-${i + 1}`);

const clear = (list: string[]) => db.delete(dataMigration).where(inArray(dataMigration.id, list));

const quiet = () => {};

test("a migration that finishes is recorded, and skipped on the next run", async () => {
  const [id] = ids("records", 1);
  await clear([id]);

  let runs = 0;
  const migration: DataMigration = {
    id,
    run: async () => {
      runs += 1;
    },
  };

  expect(await runPendingDataMigrations([migration], quiet)).toEqual([{ id, status: "applied" }]);
  expect(runs).toBe(1);

  // The ledger row is the whole point: a second boot must not run it again.
  expect(await runPendingDataMigrations([migration], quiet)).toEqual([{ id, status: "skipped" }]);
  expect(runs).toBe(1);

  await clear([id]);
});

test("a migration that throws leaves no ledger row, so the next boot retries it", async () => {
  const [id] = ids("retry", 1);
  await clear([id]);

  let runs = 0;
  const migration: DataMigration = {
    id,
    run: async () => {
      runs += 1;
      // Fails the first time only, standing in for a transient storage error.
      if (runs === 1) throw new Error("boom");
    },
  };

  const [failed] = await runPendingDataMigrations([migration], quiet);
  expect(failed.status).toBe("failed");
  expect(await db.select().from(dataMigration).where(eq(dataMigration.id, id))).toHaveLength(0);

  // The retry succeeds and records.
  expect(await runPendingDataMigrations([migration], quiet)).toEqual([{ id, status: "applied" }]);
  expect(runs).toBe(2);

  await clear([id]);
});

test("{ done: false } means progress without completion: no row, run again", async () => {
  const [id] = ids("chunked", 1);
  await clear([id]);

  // Converges on the third pass, like a backfill working in chunks over
  // several boots.
  let runs = 0;
  const migration: DataMigration = {
    id,
    run: async () => {
      runs += 1;
      return runs < 3 ? { done: false } : { done: true };
    },
  };

  expect(await runPendingDataMigrations([migration], quiet)).toEqual([{ id, status: "pending" }]);
  expect(await runPendingDataMigrations([migration], quiet)).toEqual([{ id, status: "pending" }]);
  expect(await db.select().from(dataMigration).where(eq(dataMigration.id, id))).toHaveLength(0);

  expect(await runPendingDataMigrations([migration], quiet)).toEqual([{ id, status: "applied" }]);
  expect(await runPendingDataMigrations([migration], quiet)).toEqual([{ id, status: "skipped" }]);
  expect(runs).toBe(3);

  await clear([id]);
});

test("a required failure stops the run; a best-effort one doesn't", async () => {
  const [first, second] = ids("ordering", 2);
  await clear([first, second]);

  const ran: string[] = [];
  const failing = (id: string, required: boolean): DataMigration => ({
    id,
    required,
    run: async () => {
      ran.push(id);
      throw new Error("boom");
    },
  });
  const ok = (id: string): DataMigration => ({
    id,
    run: async () => {
      ran.push(id);
    },
  });

  // Best-effort: the boot carries on to the next migration.
  const soft = await runPendingDataMigrations([failing(first, false), ok(second)], quiet);
  expect(soft.map((o) => o.status)).toEqual(["failed", "applied"]);
  expect(ran).toEqual([first, second]);

  await clear([first, second]);
  ran.length = 0;

  // Required: later migrations may depend on it, so nothing after it runs.
  const hard = await runPendingDataMigrations([failing(first, true), ok(second)], quiet);
  expect(hard.map((o) => o.status)).toEqual(["failed"]);
  expect(ran).toEqual([first]);
  expect(await db.select().from(dataMigration).where(eq(dataMigration.id, second))).toHaveLength(0);

  await clear([first, second]);
});

test("migrations run in the order given", async () => {
  const list = ids("order", 3);
  await clear(list);

  const ran: string[] = [];
  const migrations = list.map((id) => ({
    id,
    run: async () => {
      ran.push(id);
    },
  }));

  await runPendingDataMigrations(migrations, quiet);
  expect(ran).toEqual(list);

  await clear(list);
});
