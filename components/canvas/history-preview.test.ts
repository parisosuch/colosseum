import { describe, expect, test } from "bun:test";
import * as Y from "yjs";

import { docWith } from "@/lib/canvas/test-doc";
import { elementsOf } from "@/lib/realtime/canvas-doc";
import { CanvasStore } from "./canvas-store";
import { closePreviewStore, createPreviewStore, decodeBase64 } from "./history-preview";

function encode(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

function liveStore(): CanvasStore {
  const live = new CanvasStore(7, "write", "user-1");
  live.viewport = { w: 1200, h: 800 };
  live.insets = { top: 66, right: 0, bottom: 62, left: 0 };
  live.setCamera({ x: -40, y: 25, z: 0.5 });
  return live;
}

describe("decodeBase64", () => {
  test("round-trips bytes Buffer encoded", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect([...decodeBase64(Buffer.from(bytes).toString("base64"))]).toEqual([...bytes]);
  });
});

describe("createPreviewStore", () => {
  test("holds the version's elements, read-only and framed like the live board", () => {
    const live = liveStore();
    const version = docWith({
      a: { type: "rect", x: 10, y: 20, w: 100, h: 50 },
      b: { type: "sticky", x: 200, y: 0, w: 160, h: 160 },
    });
    const preview = createPreviewStore(live, encode(version));
    expect([...preview.docState.elements.keys()].sort()).toEqual(["a", "b"]);
    expect(preview.docState.ordered.map((e) => e.id)).toEqual(["a", "b"]);
    expect(preview.canEdit).toBe(false);
    expect(preview.channelId).toBe(7);
    expect(preview.camera).toEqual(live.camera);
    expect(preview.viewport).toEqual(live.viewport);
    expect(preview.insets).toEqual(live.insets);
    preview.destroy();
    live.destroy();
  });

  test("leaves the live doc alone, and later live edits don't reach the preview", () => {
    const live = liveStore();
    elementsOf(live.doc).set("live-only", new Y.Map());
    const version = docWith({ old: { type: "rect", w: 10, h: 10 } });
    const preview = createPreviewStore(live, encode(version));
    expect(elementsOf(live.doc).has("old")).toBe(false);
    elementsOf(live.doc).delete("live-only");
    Y.applyUpdate(live.doc, Y.encodeStateAsUpdate(docWith({ late: { type: "rect" } })));
    expect([...elementsOf(preview.doc).keys()]).toEqual(["old"]);
    preview.destroy();
    live.destroy();
  });

  test("an empty version previews as an empty board", () => {
    const live = liveStore();
    const preview = createPreviewStore(live, encode(new Y.Doc()));
    expect(preview.docState.ordered).toEqual([]);
    preview.destroy();
    live.destroy();
  });

  test("a malformed update throws", () => {
    const live = liveStore();
    expect(() =>
      createPreviewStore(live, Buffer.from([255, 255, 255]).toString("base64")),
    ).toThrow();
    live.destroy();
  });
});

describe("closePreviewStore", () => {
  test("hands the preview's camera back to the live board", () => {
    const live = liveStore();
    const preview = createPreviewStore(live, encode(new Y.Doc()));
    preview.setCamera({ x: 300, y: -10, z: 2 });
    closePreviewStore(preview, live);
    expect(live.camera).toEqual({ x: 300, y: -10, z: 2 });
    live.destroy();
  });
});
