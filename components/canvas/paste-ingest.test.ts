import { afterEach, describe, expect, test } from "bun:test";

import { CANVAS_MIME } from "@/lib/canvas/clipboard";
import { BLOCK_DEFAULT_SIZE, createElement } from "@/lib/canvas/elements";
import { PASTED_TEXT_MAX_WIDTH, mediaRect, rowSlots } from "@/lib/canvas/paste-content";
import type { Column } from "@/lib/colosseum/column";
import { CanvasStore } from "./canvas-store";
import { carriesOutsideContent, handleDrop, handlePaste, LAYER_DRAG_TYPE } from "./paste";
import { ingestContent, pendingUploads, registerIngest, type IngestDeps } from "./paste-ingest";

let nextColumn = 100;
const column = (type = "image"): Column => ({ id: ++nextColumn, type }) as unknown as Column;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

type Harness = {
  store: CanvasStore;
  deps: IngestDeps;
  calls: string[];
  errors: string[];
  added: Column[];
};

const stores: CanvasStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.destroy();
});

function setup(overrides: Partial<IngestDeps> = {}, access: "read" | "write" = "write"): Harness {
  const store = new CanvasStore(1, access, "u1");
  stores.push(store);
  const calls: string[] = [];
  const errors: string[] = [];
  const added: Column[] = [];
  const deps: IngestDeps = {
    createFile: async (f) => {
      calls.push(`file:${f.name}`);
      return column();
    },
    createFromImageUrl: async (u) => {
      calls.push(`image-url:${u}`);
      return column();
    },
    createUrl: async (u) => {
      calls.push(`url:${u}`);
      return column("url");
    },
    addColumns: (cols) => {
      // The block reaches the page before its element exists.
      for (const c of cols) expect(store.docState.placed.has(c.id)).toBe(false);
      added.push(...cols);
    },
    failureMessage: async (e) => (e instanceof Error ? e.message : "failed"),
    error: (m) => errors.push(m),
    ...overrides,
  };
  registerIngest(store, deps);
  return { store, deps, calls, errors, added };
}

function setAccess(store: CanvasStore, access: "read" | "write") {
  (store as unknown as { connection: CanvasStore["connection"] }).connection = {
    ...store.connection,
    access,
  };
}

const png = (name = "a.png") => new File([new Uint8Array(8)], name, { type: "image/png" });

function blockAt(store: CanvasStore, columnId: number) {
  return [...store.docState.elements.values()].find((e) => e.columnId === columnId);
}

describe("placeholder lifecycle", () => {
  test("a placeholder holds the spot until the block lands there", async () => {
    const d = deferred<Column>();
    const h = setup({ createUrl: () => d.promise });
    const at = { x: 400, y: 300 };
    const done = ingestContent(h.store, { kind: "url", url: "https://example.com" }, at);

    const holders = pendingUploads(h.store).snapshot();
    expect(holders).toHaveLength(1);
    expect(holders[0]!.rect).toEqual(mediaRect(rowSlots(at, 1)[0]!));
    expect(holders[0]!.label).toBe("Adding link");
    expect(h.store.docState.elements.size).toBe(0);

    const col = column("url");
    d.resolve(col);
    const ids = await done;

    expect(pendingUploads(h.store).snapshot()).toHaveLength(0);
    expect(h.added).toEqual([col]);
    const el = blockAt(h.store, col.id)!;
    expect(ids).toEqual([el.id]);
    expect(el.parentId).toBeNull();
    expect(el.x + el.w / 2).toBe(at.x);
    expect(el.y + el.h / 2).toBe(at.y);
    // Placed straight onto the canvas, so not in the unplaced list.
    expect(h.store.docState.placed.has(col.id)).toBe(true);
    expect([...h.store.selection]).toEqual([el.id]);
  });

  test("several files lay out in a row and upload one at a time", async () => {
    const pending = [deferred<Column>(), deferred<Column>(), deferred<Column>()];
    let i = 0;
    const h = setup({ createFile: () => pending[i++]!.promise });
    const at = { x: 0, y: 0 };
    const files = [png("a.png"), png("b.png"), png("c.png")];
    const done = ingestContent(h.store, { kind: "files", files, imageSource: null }, at);

    const slots = rowSlots(at, 3);
    expect(
      pendingUploads(h.store)
        .snapshot()
        .map((p) => p.rect),
    ).toEqual(slots.map(mediaRect));
    // Only the first upload has started.
    expect(i).toBe(1);

    const cols = [column(), column(), column()];
    pending[0]!.resolve(cols[0]!);
    await tick();
    expect(pendingUploads(h.store).snapshot()).toHaveLength(2);
    expect(i).toBe(2);
    pending[1]!.resolve(cols[1]!);
    await tick();
    pending[2]!.resolve(cols[2]!);
    const ids = await done;

    expect(ids).toHaveLength(3);
    cols.forEach((c, n) => {
      const el = blockAt(h.store, c.id)!;
      expect(el.x).toBe(slots[n]!.x);
      expect(el.y).toBe(slots[n]!.y);
      expect(el.w).toBe(BLOCK_DEFAULT_SIZE.w);
    });
    expect(new Set(h.store.selection)).toEqual(new Set(ids));
  });

  test("a selection made during the upload is left alone", async () => {
    const d = deferred<Column>();
    const h = setup({ createFile: () => d.promise });
    const done = ingestContent(
      h.store,
      { kind: "files", files: [png()], imageSource: null },
      { x: 0, y: 0 },
    );
    const other = createElement(
      h.store.doc,
      { type: "rect", x: 0, y: 0, w: 10, h: 10, createdBy: "u1" },
      h.store.origin,
    );
    h.store.setSelection([other]);
    d.resolve(column());
    await done;
    expect([...h.store.selection]).toEqual([other]);
  });
});

describe("failures", () => {
  test("a failed upload drops its placeholder and shows the server's message", async () => {
    const h = setup({
      createFile: async () => {
        throw new Error("That image is too large (max 10MB).");
      },
    });
    const ids = await ingestContent(
      h.store,
      { kind: "files", files: [png()], imageSource: null },
      { x: 0, y: 0 },
    );
    expect(ids).toEqual([]);
    expect(pendingUploads(h.store).snapshot()).toHaveLength(0);
    expect(h.errors).toEqual(["That image is too large (max 10MB)."]);
    expect(h.store.docState.elements.size).toBe(0);
  });

  test("one failure among several leaves the others placed, and a repeated reason is said once", async () => {
    let n = 0;
    const h = setup({
      createFile: async () => {
        n++;
        if (n === 1) return column();
        throw new Error("You've reached your limit of 3 columns.");
      },
    });
    const ids = await ingestContent(
      h.store,
      { kind: "files", files: [png("a.png"), png("b.png"), png("c.png")], imageSource: null },
      { x: 0, y: 0 },
    );
    expect(ids).toHaveLength(1);
    expect(h.errors).toEqual(["You've reached your limit of 3 columns."]);
    expect(pendingUploads(h.store).snapshot()).toHaveLength(0);
  });

  test("unsupported and oversized files are reported by name and skipped", async () => {
    const h = setup();
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "huge.png", { type: "image/png" });
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    const ids = await ingestContent(
      h.store,
      { kind: "files", files: [big, svg, png("ok.png")], imageSource: null },
      { x: 0, y: 0 },
    );
    expect(h.errors).toEqual([
      "huge.png: That file is too large (max 10MB).",
      "logo.svg: That's not an image, video, or PDF.",
    ]);
    expect(h.calls).toEqual(["file:ok.png"]);
    // The one good file is centred on the point on its own.
    expect(ids).toHaveLength(1);
  });

  test("a block created after write access is lost isn't placed", async () => {
    const d = deferred<Column>();
    const h = setup({ createUrl: () => d.promise });
    const done = ingestContent(h.store, { kind: "url", url: "example.com" }, { x: 0, y: 0 });
    setAccess(h.store, "read");
    const col = column("url");
    d.resolve(col);
    expect(await done).toEqual([]);
    // The block exists (the page has it) and stays in the Blocks panel.
    expect(h.added).toEqual([col]);
    expect(h.store.docState.placed.has(col.id)).toBe(false);
    expect(pendingUploads(h.store).snapshot()).toHaveLength(0);
    expect(h.errors).toEqual([]);
  });

  test("a copied image falls back to the clipboard's file when its original can't be fetched", async () => {
    const h = setup({
      createFromImageUrl: async (u) => {
        h.calls.push(`image-url:${u}`);
        throw new Error("fetch failed");
      },
    });
    const ids = await ingestContent(
      h.store,
      { kind: "files", files: [png("image.png")], imageSource: "https://cdn.example.com/cat.gif" },
      { x: 0, y: 0 },
    );
    expect(h.calls).toEqual(["image-url:https://cdn.example.com/cat.gif", "file:image.png"]);
    expect(ids).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });
});

describe("text", () => {
  test("plain text becomes a text element centred on the point, and no block", async () => {
    const h = setup();
    const ids = await ingestContent(
      h.store,
      { kind: "text", text: "remember this" },
      { x: 50, y: 60 },
    );
    expect(ids).toHaveLength(1);
    const el = h.store.docState.elements.get(ids[0]!)!;
    expect(el.type).toBe("text");
    expect(el.text).toBe("remember this");
    expect(el.autoSize).toBe(true);
    // Within the pixel the doc rounds positions to.
    expect(Math.abs(el.x + el.w / 2 - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(el.y + el.h / 2 - 60)).toBeLessThanOrEqual(1);
    expect(h.calls).toEqual([]);
    expect(h.added).toEqual([]);
    expect([...h.store.selection]).toEqual(ids);
  });

  test("a long line wraps at the paste width", async () => {
    const h = setup();
    const ids = await ingestContent(
      h.store,
      { kind: "text", text: "word ".repeat(400).trim() },
      {
        x: 0,
        y: 0,
      },
    );
    const el = h.store.docState.elements.get(ids[0]!)!;
    expect(el.w).toBe(PASTED_TEXT_MAX_WIDTH);
    expect(el.autoSize).toBe(false);
  });
});

describe("clipboard and drop events", () => {
  function clipboardEvent(data: Record<string, string>, files: File[] = []) {
    let prevented = false;
    const e = {
      clipboardData: {
        types: [...(files.length ? ["Files"] : []), ...Object.keys(data)],
        files,
        getData: (f: string) => data[f] ?? "",
      },
      preventDefault: () => {
        prevented = true;
      },
    };
    return { e: e as unknown as ClipboardEvent, prevented: () => prevented };
  }

  test("a read-only viewer's paste does nothing", async () => {
    const h = setup({}, "read");
    const { e, prevented } = clipboardEvent({ "text/plain": "https://example.com" });
    expect(handlePaste(h.store, e)).toBe(false);
    expect(prevented()).toBe(false);
    await tick();
    expect(h.calls).toEqual([]);
    expect(pendingUploads(h.store).snapshot()).toHaveLength(0);
    expect(h.store.docState.elements.size).toBe(0);
  });

  test("a pasted URL lands at the pointer", async () => {
    const h = setup();
    h.store.pointer = { x: 700, y: 800 };
    const { e, prevented } = clipboardEvent({ "text/plain": "https://example.com/x" });
    expect(handlePaste(h.store, e)).toBe(true);
    expect(prevented()).toBe(true);
    await tick();
    await tick();
    expect(h.calls).toEqual(["url:https://example.com/x"]);
    const el = blockAt(h.store, h.added[0]!.id)!;
    expect(el.x + el.w / 2).toBe(700);
    expect(el.y + el.h / 2).toBe(800);
  });

  test("the canvas's own clipboard still pastes elements, not text", () => {
    const h = setup();
    const payload = {
      kind: "colosseum-canvas",
      version: 1,
      channelId: 1,
      elements: [
        { id: "r", parentId: null, fields: { type: "rect", x: 0, y: 0, w: 10, h: 10, z: "a0" } },
      ],
    };
    const { e } = clipboardEvent({
      [CANVAS_MIME]: JSON.stringify(payload),
      "text/plain": "1 canvas element",
    });
    expect(handlePaste(h.store, e)).toBe(true);
    const els = [...h.store.docState.elements.values()];
    expect(els.map((x) => x.type)).toEqual(["rect"]);
    expect(h.calls).toEqual([]);
  });

  test("a desktop file drop uploads at the drop point", async () => {
    const h = setup();
    let prevented = false;
    const e = {
      dataTransfer: { types: ["Files"], files: [png("drop.png")], getData: () => "" },
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as DragEvent;
    expect(handleDrop(h.store, e, { x: -100, y: 40 })).toBe(true);
    expect(prevented).toBe(true);
    expect(pendingUploads(h.store).snapshot()).toHaveLength(1);
    await tick();
    await tick();
    expect(h.calls).toEqual(["file:drop.png"]);
    const el = blockAt(h.store, h.added[0]!.id)!;
    expect(el.x + el.w / 2).toBe(-100);
    expect(el.y + el.h / 2).toBe(40);
  });
});

describe("drags that started on the page", () => {
  test("a Layers row isn't outside content, and neither is anything dragged from the page", () => {
    expect(carriesOutsideContent([LAYER_DRAG_TYPE])).toBe(false);
    // A row or a comment's selected text from an older browser that adds text.
    expect(carriesOutsideContent([LAYER_DRAG_TYPE, "text/plain"])).toBe(false);
    expect(carriesOutsideContent(["text/plain"], true)).toBe(false);
    expect(carriesOutsideContent(["text/uri-list", "text/plain"], true)).toBe(false);
    // The same types from another tab or the desktop are.
    expect(carriesOutsideContent(["text/plain"])).toBe(true);
    expect(carriesOutsideContent(["Files"])).toBe(true);
  });
});
