// Worker thread for canvas restores (canvas-restore-pool.ts). It computes
// `revertUpdate`, which loads a whole version into a scratch Y.Doc and takes
// seconds on a heavy canvas, so the thread serving every room only applies the
// result.

import { revertUpdate } from "./canvas-history";
import type { RevertReply, RevertRequest } from "./canvas-restore-pool";

declare const self: {
  onmessage: ((event: MessageEvent<RevertRequest>) => void) | null;
  postMessage(message: RevertReply, options?: { transfer?: Transferable[] }): void;
};

self.onmessage = (event) => {
  const { id, current, version } = event.data;
  try {
    const update = revertUpdate(current, version);
    self.postMessage({ id, update }, { transfer: [update.buffer] });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
