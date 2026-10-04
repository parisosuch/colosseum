// Runs canvas restore computations on one worker thread, started on first use.
// Only server.ts (and tests) import this; the Next bundle never loads it.
//
// Jobs are handed to the worker one at a time, so the timeout below counts only
// the time the worker spends on a job, never the time it waited behind others.

export type RevertRequest = { id: number; current: Uint8Array; version: Uint8Array };
export type RevertReply = { id: number; update: Uint8Array } | { id: number; error: string };

type Job = {
  req: RevertRequest;
  resolve: (update: Uint8Array) => void;
  reject: (err: Error) => void;
};

// A 5,000-stroke canvas takes under 2s. Some malformed docs make Yjs loop
// rather than throw, and every later restore would queue behind that.
const DEFAULT_TIMEOUT_MS = 60_000;

const WORKER_URL = new URL("./canvas-restore-worker.ts", import.meta.url).href;

export function createRestoreWorker({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  // For tests: a stand-in worker speaking the same messages.
  workerUrl = WORKER_URL,
} = {}) {
  let worker: Worker | null = null;
  let nextId = 1;
  const queue: Job[] = [];
  // The job the worker is on, and the timer counting it down.
  let running: { job: Job; timer: ReturnType<typeof setTimeout> } | null = null;

  // Fail the running job and replace the worker. Queued jobs go to the new one.
  function kill(w: Worker, err: Error) {
    if (worker !== w) return;
    worker = null;
    w.terminate();
    const job = running?.job;
    if (running) clearTimeout(running.timer);
    running = null;
    job?.reject(err);
    next();
  }

  function spawn(): Worker {
    const w = new Worker(workerUrl);
    w.onmessage = (event: MessageEvent<RevertReply>) => {
      const reply = event.data;
      if (worker !== w || !running || running.job.req.id !== reply.id) return;
      const { job, timer } = running;
      clearTimeout(timer);
      running = null;
      if ("error" in reply) job.reject(new Error(`restore worker: ${reply.error}`));
      else job.resolve(reply.update);
      next();
    };
    // A crashed worker fails the job it was on; the next one starts a new worker.
    w.onerror = (event) => kill(w, new Error(`restore worker crashed: ${event.message}`));
    // Never keeps the process alive on its own.
    (w as Worker & { unref?: () => void }).unref?.();
    return w;
  }

  function next() {
    if (running) return;
    const job = queue.shift();
    if (!job) return;
    const w = (worker ??= spawn());
    // A stuck worker is replaced, failing only the job it was stuck on.
    const timer = setTimeout(
      () => kill(w, new Error(`restore worker timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    running = { job, timer };
    w.postMessage(job.req, [job.req.current.buffer, job.req.version.buffer]);
  }

  return {
    compute(current: Uint8Array, version: Uint8Array): Promise<Uint8Array> {
      // Copies, so the caller's buffers stay usable after the transfer.
      const req: RevertRequest = {
        id: nextId++,
        current: current.slice(),
        version: version.slice(),
      };
      return new Promise((resolve, reject) => {
        queue.push({ req, resolve, reject });
        next();
      });
    },

    terminate(): void {
      const w = worker;
      worker = null;
      w?.terminate();
      const err = new Error("restore worker stopped");
      if (running) {
        clearTimeout(running.timer);
        running.job.reject(err);
        running = null;
      }
      for (const job of queue.splice(0)) job.reject(err);
    },
  };
}
