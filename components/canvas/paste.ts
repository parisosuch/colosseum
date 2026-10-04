// The canvas's clipboard and drop handlers. Copy and cut put the selection on
// the clipboard under the canvas MIME type with a plain-text version; paste
// reads it back. Content from outside the canvas (links, images, files, text),
// pasted or dropped, goes to paste-ingest.ts.

import {
  CANVAS_MIME,
  clipboardText,
  parseClipboard,
  pasteClipboard,
  type CanvasClipboard,
} from "@/lib/canvas/clipboard";
import { viewCenter, type Point } from "@/lib/canvas/camera";
import { readPasteContent, type TransferLike } from "@/lib/canvas/paste-content";
import { copyPayload, deleteSelection } from "./actions";
import type { CanvasStore } from "./canvas-store";
import { canIngest, ingestContent } from "./paste-ingest";

// The last copy from this page. A browser that doesn't keep our MIME type on
// the system clipboard still hands back the plain text, and that text is how
// the paste is recognised as our own instead of becoming a text element.
let lastCopy: { text: string; payload: CanvasClipboard } | null = null;

export function handleCopy(store: CanvasStore, e: ClipboardEvent, cut: boolean): boolean {
  const payload = copyPayload(store);
  if (!payload || !e.clipboardData) return false;
  e.preventDefault();
  const text = clipboardText(payload);
  e.clipboardData.setData(CANVAS_MIME, JSON.stringify(payload));
  e.clipboardData.setData("text/plain", text);
  lastCopy = { text, payload };
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
  const clip =
    parseClipboard(e.clipboardData.getData(CANVAS_MIME)) ??
    (lastCopy && e.clipboardData.getData("text/plain") === lastCopy.text ? lastCopy.payload : null);
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
        known: store.docState,
      },
      store.origin,
    );
    if (ids.length) store.setSelection(ids);
    return true;
  }
  return ingestTransfer(store, e.clipboardData, pasteTarget(store), () => e.preventDefault());
}

// What a dragged Layers row carries: private to the panel, so a row dropped
// anywhere else hands over nothing, not its name as text.
export const LAYER_DRAG_TYPE = "application/x-colosseum-layer";

// A drag from outside the page (files from the desktop, a link or text from
// another tab) that the board would take. Nothing that started on this page
// counts: a Layers row or text selected in a comment would otherwise land as a
// text element, or as a link block when it reads like a URL.
export function carriesOutsideContent(types: readonly string[], fromPage = false): boolean {
  if (fromPage || types.includes(LAYER_DRAG_TYPE)) return false;
  return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain");
}

// A drop of outside content at `at` (world space).
export function handleDrop(store: CanvasStore, e: DragEvent, at: Point): boolean {
  if (!e.dataTransfer) return false;
  return ingestTransfer(store, e.dataTransfer, at, () => e.preventDefault());
}

function ingestTransfer(
  store: CanvasStore,
  data: TransferLike,
  at: Point,
  claim: () => void,
): boolean {
  if (!canIngest(store)) return false;
  const content = readPasteContent(data);
  if (!content) return false;
  claim();
  void ingestContent(store, content, at);
  return true;
}
