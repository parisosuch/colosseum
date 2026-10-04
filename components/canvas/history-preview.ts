// A version opened read-only on the canvas. The preview action's Yjs update
// goes into a CanvasStore of its own that never connects, so the viewport
// draws it with the same code as the live board, and nothing done while
// previewing can reach the live doc. The live store keeps its socket and
// stays current underneath; the page just stops drawing it.

import * as Y from "yjs";

import { CanvasStore } from "./canvas-store";

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// A read-only store holding the version, framed where the live board is.
// Throws when the update isn't a Yjs update.
export function createPreviewStore(live: CanvasStore, doc: string): CanvasStore {
  const preview = new CanvasStore(live.channelId, "read", live.viewerId);
  try {
    Y.applyUpdate(preview.doc, decodeBase64(doc));
  } catch (err) {
    preview.destroy();
    throw err;
  }
  preview.viewport = live.viewport;
  preview.insets = live.insets;
  preview.setCamera(live.camera);
  return preview;
}

// Leave a preview: the live board picks up where the preview's camera was, so
// switching between the two doesn't jump.
export function closePreviewStore(preview: CanvasStore, live: CanvasStore): void {
  live.setCamera(preview.camera);
  preview.destroy();
}
