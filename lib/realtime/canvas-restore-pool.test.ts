import { expect, test } from "bun:test";

import { createRestoreWorker } from "./canvas-restore-pool";

const FIXTURE = new URL("./canvas-restore-worker.fixture.ts", import.meta.url).href;

// `tenths` of a second of work; 255 hangs.
const job = (tag: number, tenths: number) =>
  [new Uint8Array([tag]), new Uint8Array([tenths])] as const;

test("the timeout counts a job's own run time, not its wait in the queue", async () => {
  // Four 0.4s jobs against a 1s timeout: the last one finishes 1.6s after it
  // was queued, which used to count against it.
  const worker = createRestoreWorker({ timeoutMs: 1000, workerUrl: FIXTURE });
  try {
    const results = await Promise.all([1, 2, 3, 4].map((tag) => worker.compute(...job(tag, 4))));
    expect(results.map((r) => r[0])).toEqual([1, 2, 3, 4]);
  } finally {
    worker.terminate();
  }
});

test("a job that hangs fails alone and the jobs queued behind it still run", async () => {
  const worker = createRestoreWorker({ timeoutMs: 500, workerUrl: FIXTURE });
  try {
    const before = worker.compute(...job(1, 1));
    const stuck = worker.compute(...job(2, 255));
    const after = [worker.compute(...job(3, 1)), worker.compute(...job(4, 1))];
    expect((await before)[0]).toBe(1);
    await expect(stuck).rejects.toThrow(/timed out/);
    expect((await Promise.all(after)).map((r) => r[0])).toEqual([3, 4]);
  } finally {
    worker.terminate();
  }
});

test("terminate fails the running job and everything queued", async () => {
  const worker = createRestoreWorker({ timeoutMs: 5000, workerUrl: FIXTURE });
  const jobs = [worker.compute(...job(1, 255)), worker.compute(...job(2, 1))];
  worker.terminate();
  for (const j of jobs) await expect(j).rejects.toThrow(/stopped/);
});
