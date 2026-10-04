// Pastes and drops from outside the canvas: files and links become blocks
// placed on the board, other text becomes a text element.
//
// A block is two writes. The server creates it in the channel, then this
// client places its element in the doc. While the first runs, a placeholder
// holds the spot; it's local to this client, so a tab closed mid-upload leaves
// nothing behind on anyone's board. If the block is created but placing it
// fails (write access lost, the page gone), it stays in the channel and shows
// up in the Blocks panel like any block added elsewhere.
//
// The server calls are handed in by the page (registerIngest), so this module
// imports no server actions and its lifecycle can be tested on its own.

import type { Point, Rect } from "@/lib/canvas/camera";
import { newText } from "@/lib/canvas/create";
import { createElement, placeBlock } from "@/lib/canvas/elements";
import {
  PASTED_TEXT_MAX_WIDTH,
  mediaRect,
  rectCenter,
  rowSlots,
  type PasteContent,
} from "@/lib/canvas/paste-content";
import type { Column } from "@/lib/colosseum/column";
import { fileProblem } from "@/lib/upload-limits";
import type { CanvasStore } from "./canvas-store";
import { measureText } from "./measure-text";

export type IngestDeps = {
  createFile(file: File): Promise<Column>;
  // The original of a copied image, fetched by the server.
  createFromImageUrl(url: string): Promise<Column>;
  createUrl(url: string): Promise<Column>;
  // The new block, before its element exists, so the board can draw it the
  // moment it's placed instead of loading it.
  addColumns(columns: Column[]): void;
  // What to say when a create fails.
  failureMessage(error: unknown): Promise<string>;
  error(message: string): void;
};

export type Placeholder = { id: string; rect: Rect; label: string };

// The placeholders this client is showing, with a subscription for the
// component that draws them.
export class PendingUploads {
  private items: readonly Placeholder[] = [];
  private listeners = new Set<() => void>();
  private next = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): readonly Placeholder[] => this.items;

  add(rect: Rect, label: string): string {
    const id = `upload-${++this.next}`;
    this.items = [...this.items, { id, rect, label }];
    this.emit();
    return id;
  }

  remove(id: string): void {
    const kept = this.items.filter((p) => p.id !== id);
    if (kept.length === this.items.length) return;
    this.items = kept;
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

const deps = new WeakMap<CanvasStore, IngestDeps>();
const pending = new WeakMap<CanvasStore, PendingUploads>();

// Hand a board its server calls. Returns the undo for an effect's cleanup.
export function registerIngest(store: CanvasStore, ingest: IngestDeps): () => void {
  deps.set(store, ingest);
  return () => {
    if (deps.get(store) === ingest) deps.delete(store);
  };
}

export function pendingUploads(store: CanvasStore): PendingUploads {
  let p = pending.get(store);
  if (!p) pending.set(store, (p = new PendingUploads()));
  return p;
}

// Whether outside content can go onto this board now.
export function canIngest(store: CanvasStore): boolean {
  return store.canEdit && deps.has(store);
}

// Paste or drop `content` at `at` (world space). Resolves with the ids of the
// elements it made once every upload has finished.
export async function ingestContent(
  store: CanvasStore,
  content: PasteContent,
  at: Point,
): Promise<string[]> {
  const ingest = deps.get(store);
  if (!ingest || !store.canEdit) return [];
  switch (content.kind) {
    case "text": {
      const id = pasteText(store, content.text, at);
      return id ? [id] : [];
    }
    case "url":
      return runJobs(store, ingest, rowSlots(at, 1), [
        { label: "Adding link", run: () => ingest.createUrl(content.url) },
      ]);
    case "files": {
      const ok: File[] = [];
      for (const f of content.files) {
        const problem = fileProblem(f);
        if (problem) ingest.error(f.name ? `${f.name}: ${problem}` : problem);
        else ok.push(f);
      }
      if (ok.length === 0) return [];
      const source = ok.length === 1 ? content.imageSource : null;
      return runJobs(
        store,
        ingest,
        rowSlots(at, ok.length),
        ok.map((file) => ({
          label: "Uploading",
          run: source
            ? // The original first, so a copied GIF stays animated; the
              // clipboard's own file if the server can't fetch it.
              () => ingest.createFromImageUrl(source).catch(() => ingest.createFile(file))
            : () => ingest.createFile(file),
        })),
      );
    }
  }
}

type Job = { label: string; run: () => Promise<Column> };

// One at a time, like every other multi-file add: Next runs a page's server
// actions in sequence anyway, and the placeholders show what's still to come.
async function runJobs(
  store: CanvasStore,
  ingest: IngestDeps,
  slots: Rect[],
  jobs: Job[],
): Promise<string[]> {
  const uploads = pendingUploads(store);
  const selectionBefore = store.selection;
  const holders = jobs.map((job, i) => uploads.add(mediaRect(slots[i]!), job.label));
  const placed: string[] = [];
  // A quota hit fails every file after it the same way; say so once.
  const said = new Set<string>();
  for (const [i, job] of jobs.entries()) {
    try {
      const column = await job.run();
      ingest.addColumns([column]);
      const id = placeColumn(store, column.id, slots[i]!);
      if (id) placed.push(id);
    } catch (e) {
      console.error(e);
      const message = await ingest.failureMessage(e);
      if (!said.has(message)) {
        said.add(message);
        ingest.error(message);
      }
    } finally {
      uploads.remove(holders[i]!);
    }
  }
  // Select what landed, unless the person has selected something else since.
  if (placed.length > 0 && store.selection === selectionBefore) store.setSelection(placed);
  return placed;
}

// Put a new block where its placeholder was. Null when it can't be placed,
// which leaves the block in the Blocks panel.
export function placeColumn(store: CanvasStore, columnId: number, slot: Rect): string | null {
  if (!store.canEdit || store.docState.placed.has(columnId)) return null;
  try {
    store.undo.stopCapturing();
    return placeBlock(
      store.doc,
      { columnId, at: rectCenter(slot), createdBy: store.userId },
      store.origin,
      store.docState,
    );
  } catch (e) {
    console.error(e);
    return null;
  }
}

// Text as a text element in the session's text style, centred on `at`. Its
// width follows the text up to PASTED_TEXT_MAX_WIDTH, and wraps past that.
export function pasteText(store: CanvasStore, text: string, at: Point): string | null {
  if (!store.canEdit || !text) return null;
  const style = store.toolStyle;
  const natural = measureText(text, style.fontSize, style.weight);
  const wrap = natural.w > PASTED_TEXT_MAX_WIDTH;
  const size = wrap
    ? measureText(text, style.fontSize, style.weight, PASTED_TEXT_MAX_WIDTH)
    : natural;
  const base = newText(at, style, {
    parentId: null,
    origin: { x: 0, y: 0 },
    createdBy: store.userId,
  });
  store.undo.stopCapturing();
  const id = createElement(
    store.doc,
    {
      ...base,
      x: at.x - size.w / 2,
      y: at.y - size.h / 2,
      w: size.w,
      h: size.h,
      text,
      autoSize: !wrap,
    },
    store.origin,
    store.docState,
  );
  store.setSelection([id]);
  return id;
}
