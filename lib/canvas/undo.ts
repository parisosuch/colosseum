// Undo and redo per person. The manager tracks only transactions carrying the
// local client's origin, so it never reverts what someone else did, even when
// their edit touched the same element: Yjs undoes this client's change and
// leaves theirs.

import * as Y from "yjs";

import { elementsOf } from "@/lib/realtime/canvas-doc";

// Edits closer together than this merge into one undo step, which is what
// turns a drag's many writes into one.
export const CAPTURE_MS = 500;

export function createUndoManager(doc: Y.Doc, origin: unknown): Y.UndoManager {
  return new Y.UndoManager(elementsOf(doc), {
    trackedOrigins: new Set([origin]),
    captureTimeout: CAPTURE_MS,
  });
}
