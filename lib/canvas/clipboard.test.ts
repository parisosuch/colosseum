import { describe, expect, test } from "bun:test";

import {
  CANVAS_MIME,
  clipboardText,
  copySelection,
  duplicateSelection,
  parseClipboard,
  pasteClipboard,
  PASTE_OFFSET,
} from "./clipboard";
import { docWith, ORIGIN, state } from "./test-doc";

const scene = () =>
  docWith({
    f: { type: "frame", x: 100, y: 100, w: 300, h: 300, name: "Ideas" },
    note: {
      type: "sticky",
      x: 10,
      y: 10,
      w: 100,
      h: 100,
      parentId: "f",
      text: "ship it",
      fill: "yellow",
    },
    box: { type: "rect", x: 600, y: 100, w: 50, h: 50 },
    arrow: {
      type: "arrow",
      start: { kind: "bound", elementId: "box", ax: 0.5, ay: 0.5 },
      end: { kind: "bound", elementId: "note", ax: 0.5, ay: 0.5 },
      width: 2,
    },
    block: { type: "block", columnId: 9, x: 0, y: 600, w: 256, h: 292 },
  });

describe("canvas clipboard", () => {
  test("the MIME type", () => {
    expect(CANVAS_MIME).toBe("web application/x-colosseum-canvas+json");
  });

  test("copy carries descendants, top elements in world space, and a text fallback", () => {
    const doc = scene();
    const clip = copySelection(doc, ["f"], state(doc).layout, 1)!;
    expect(clip.elements.map((e) => e.id).sort()).toEqual(["f", "note"]);
    expect(clip.elements.find((e) => e.id === "f")).toMatchObject({
      parentId: null,
      fields: { x: 100, y: 100 },
    });
    expect(clip.elements.find((e) => e.id === "note")!.fields.text).toBe("ship it");
    expect(clipboardText(clip)).toBe("ship it");
  });

  test("paste: new ids, offset, children kept inside, text a fresh Y.Text", () => {
    const doc = scene();
    const clip = parseClipboard(JSON.stringify(copySelection(doc, ["f"], state(doc).layout, 1)))!;
    const [id] = pasteClipboard(
      doc,
      clip,
      { channelId: 1, createdBy: "me", placed: new Set() },
      ORIGIN,
    );
    const { all, layout } = state(doc);
    expect(id).not.toBe("f");
    expect(all.get(id)).toMatchObject({ type: "frame", x: 100 + PASTE_OFFSET, name: "Ideas" });
    const kid = [...all.values()].find((e) => e.parentId === id)!;
    expect(kid).toMatchObject({ type: "sticky", text: "ship it", x: 10 });
    expect(layout.geom.get(kid.id)!.rect.x).toBe(110 + PASTE_OFFSET);
  });

  test("bindings between pasted elements are remapped; others come loose", () => {
    const doc = scene();
    const both = copySelection(doc, ["box", "arrow", "f"], state(doc).layout, 1)!;
    const ids = pasteClipboard(
      doc,
      both,
      { channelId: 1, createdBy: "me", placed: new Set() },
      ORIGIN,
    );
    const { all } = state(doc);
    const arrow = ids.map((id) => all.get(id)!).find((e) => e.type === "arrow")!;
    expect(arrow.start?.kind === "bound" && ids.includes(arrow.start.elementId)).toBe(true);
    expect(arrow.end?.kind === "bound" && arrow.end.elementId).not.toBe("note");

    const alone = copySelection(doc, ["arrow"], state(doc).layout, 1)!;
    const [lone] = pasteClipboard(
      doc,
      alone,
      { channelId: 1, createdBy: "me", placed: new Set() },
      ORIGIN,
    );
    const el = state(doc).all.get(lone)!;
    expect(el.start?.kind).toBe("point");
    expect(el.end?.kind).toBe("point");
  });

  test("blocks paste only into their own channel, and only when not already placed", () => {
    const doc = scene();
    const clip = copySelection(doc, ["block"], state(doc).layout, 1)!;
    expect(
      pasteClipboard(doc, clip, { channelId: 2, createdBy: "me", placed: new Set() }, ORIGIN),
    ).toEqual([]);
    expect(
      pasteClipboard(doc, clip, { channelId: 1, createdBy: "me", placed: new Set([9]) }, ORIGIN),
    ).toEqual([]);
    expect(
      pasteClipboard(doc, clip, { channelId: 1, createdBy: "me", placed: new Set() }, ORIGIN),
    ).toHaveLength(1);
  });

  test("paste at a point centres the elements there", () => {
    const doc = scene();
    const clip = copySelection(doc, ["box"], state(doc).layout, 1)!;
    const [id] = pasteClipboard(
      doc,
      clip,
      { channelId: 1, createdBy: "me", placed: new Set(), at: { x: 0, y: 0 } },
      ORIGIN,
    );
    expect(state(doc).all.get(id)).toMatchObject({ x: -25, y: -25 });
  });

  test("duplicate offsets the copies and skips blocks", () => {
    const doc = scene();
    const ids = duplicateSelection(
      doc,
      ["box", "block"],
      state(doc).layout,
      { channelId: 1, createdBy: "me", placed: new Set([9]) },
      ORIGIN,
    );
    expect(ids).toHaveLength(1);
    expect(state(doc).all.get(ids[0])).toMatchObject({ type: "rect", x: 600 + PASTE_OFFSET });
  });

  test("malformed payloads are rejected whole", () => {
    expect(parseClipboard("not json")).toBeNull();
    expect(parseClipboard(JSON.stringify({ kind: "colosseum-canvas", version: 2 }))).toBeNull();
    const bad = {
      kind: "colosseum-canvas",
      version: 1,
      channelId: 1,
      elements: [{ id: "a", parentId: null, fields: { type: "script", x: 0, y: 0, w: 1, h: 1 } }],
    };
    expect(parseClipboard(JSON.stringify(bad))).toBeNull();
    const junk = {
      kind: "colosseum-canvas",
      version: 1,
      channelId: 1,
      elements: [
        { id: "a", parentId: "zz", fields: { type: "rect", x: 0, y: 0, w: 1, h: 1, evil: 1 } },
      ],
    };
    expect(parseClipboard(JSON.stringify(junk))!.elements[0]).toEqual({
      id: "a",
      parentId: null,
      fields: { type: "rect", x: 0, y: 0, w: 1, h: 1 },
    });
  });
});
