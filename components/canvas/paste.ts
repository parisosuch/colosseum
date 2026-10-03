// The canvas's clipboard handlers. Copy and cut put the selection on the
// clipboard under the canvas MIME type with a plain-text version; paste reads
// it back. Content from outside the canvas (links, images, files, text) gets
// its own branches in `handlePaste` and isn't handled yet: such a paste does
// nothing.

import { CANVAS_MIME, clipboardText, parseClipboard, pasteClipboard } from "@/lib/canvas/clipboard";
import { viewCenter, type Point } from "@/lib/canvas/camera";
import { copyPayload, deleteSelection } from "./actions";
import type { CanvasStore } from "./canvas-store";

export function handleCopy(store: CanvasStore, e: ClipboardEvent, cut: boolean): boolean {
  const payload = copyPayload(store);
  if (!payload || !e.clipboardData) return false;
  e.preventDefault();
  e.clipboardData.setData(CANVAS_MIME, JSON.stringify(payload));
  e.clipboardData.setData("text/plain", clipboardText(payload));
  if (cut) deleteSelection(store);
  return true;
}

// Where a paste lands: the pointer when it's over the board, otherwise the
// middle of the view.
export function pasteTarget(store: CanvasStore): Point {
  return store.pointer ?? viewCenter(store.camera, store.viewport, store.insets);
}

export function handlePaste(store: CanvasStore, e: ClipboardEvent): boolean {
  if (!store.canEdit || !e.clipboardData) return false;
  const clip = parseClipboard(e.clipboardData.getData(CANVAS_MIME));
  if (clip) {
    e.preventDefault();
    store.undo.stopCapturing();
    const ids = pasteClipboard(
      store.doc,
      clip,
      {
        channelId: store.channelId,
        createdBy: store.userId,
        placed: store.docState.placed,
        at: pasteTarget(store),
      },
      store.origin,
    );
    if (ids.length) store.setSelection(ids);
    return true;
  }
  // Links, images, files and plain text from outside the canvas go here.
  return false;
}
