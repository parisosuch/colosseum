// Stand-in restore worker for canvas-restore-pool.test.ts. The first byte of
// `version` says how long the job takes, in tenths of a second; 255 never
// finishes, like a doc that makes Yjs loop. The reply echoes `current`.

import type { RevertReply, RevertRequest } from "./canvas-restore-pool";

declare const self: {
  onmessage: ((event: MessageEvent<RevertRequest>) => void) | null;
  postMessage(message: RevertReply): void;
};

self.onmessage = (event) => {
  const { id, current, version } = event.data;
  const tenths = version[0] ?? 0;
  const until = tenths === 255 ? Infinity : Date.now() + tenths * 100;
  while (Date.now() < until) {
    // Busy, the way a real revert holds the thread.
  }
  self.postMessage({ id, update: current });
};
