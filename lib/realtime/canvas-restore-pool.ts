// Runs canvas restore computations on one worker thread, started on first use.
// Only server.ts (and tests) import this; the Next bundle never loads it.

export type RevertRequest = { id: number; current: Uint8Array; version: Uint8Array };
export type RevertReply = { id: number; update: Uint8Array } | { id: number; error: string };

type Pending = {
  resolve: (update: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// A 5,000-stroke canvas takes under 2s. Some malformed docs make Yjs loop
// rather than throw, and every later restore would queue behind that.
const DEFAULT_TIMEOUT_MS = 60_000;

export function createRestoreWorker({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function failAll(err: Error) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  }

  function kill(w: Worker, err: Error) {
    if (worker === w) worker = null;
    w.terminate();
    failAll(err);
  }

  function spawn(): Worker {
    const w = new Worker(new URL("./canvas-restore-worker.ts", import.meta.url).href);
    w.onmessage = (event: MessageEvent<RevertReply>) => {
      const reply = event.data;
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      clearTimeout(p.timer);
      if ("error" in reply) p.reject(new Error(`restore worker: ${reply.error}`));
      else p.resolve(reply.update);
    };
    // A crashed worker fails what it held; the next restore starts a new one.
    w.onerror = (event) => kill(w, new Error(`restore worker crashed: ${event.message}`));
    // Never keeps the process alive on its own.
    (w as Worker & { unref?: () => void }).unref?.();
    return w;
  }

  return {
    compute(current: Uint8Array, version: Uint8Array): Promise<Uint8Array> {
      const w = (worker ??= spawn());
      const id = nextId++;
      // Copies, so the caller's buffers stay usable after the transfer.
      const req: RevertRequest = { id, current: current.slice(), version: version.slice() };
      return new Promise((resolve, reject) => {
        // A stuck worker is replaced; whatever else it held fails with it.
        const timer = setTimeout(
          () => kill(w, new Error(`restore worker timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        pending.set(id, { resolve, reject, timer });
        w.postMessage(req, [req.current.buffer, req.version.buffer]);
      });
    },

    terminate(): void {
      worker?.terminate();
      worker = null;
      failAll(new Error("restore worker stopped"));
    },
  };
}
