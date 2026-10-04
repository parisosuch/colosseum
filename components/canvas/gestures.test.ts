// Grid snapping through the real gestures: a store, pointer events at screen
// points, and the element that ends up in the doc.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { Point } from "@/lib/canvas/camera";
import { DEFAULT_TOOL_STYLE, newSticky } from "@/lib/canvas/create";
import { createElement } from "@/lib/canvas/elements";
import { CanvasStore } from "./canvas-store";
import type { GestureContext } from "./gestures";
import { resetGridSetting, setGridSetting } from "./grid-setting";
import type { Tool } from "./tools";

// gestures.ts reaches React hooks through canvas-overlay's import of
// use-canvas, which the react-server build the suite runs under doesn't
// export. No hook runs here, so a stub stands in for it.
mock.module("./use-canvas", () => ({ useCanvas: () => null }));
const { beginGesture, endGesture, moveGesture } = await import("./gestures");

type Mods = { meta?: boolean; shift?: boolean };

function pointer({ meta = false, shift = false }: Mods = {}): PointerEvent {
  return {
    metaKey: meta,
    ctrlKey: false,
    shiftKey: shift,
    altKey: false,
    button: 0,
    pressure: 0.5,
  } as unknown as PointerEvent;
}

let store: CanvasStore;

function ctx(tool: Tool): GestureContext {
  return {
    store,
    tool,
    setTool: () => {},
    schedule: (fn) => fn(),
    flush: () => {},
    onOpenBlock: () => {},
    onComment: () => {},
  };
}

// Press at `from`, drag through `to`, let go there. Screen points.
function drag(tool: Tool, from: Point, to: Point, mods: Mods = {}) {
  const c = ctx(tool);
  const g = beginGesture(c, pointer(mods), from);
  if (!g) throw new Error("no gesture");
  moveGesture(c, g, pointer(mods), to);
  endGesture(c, g, pointer(mods), to);
}

function sticky(x: number, y: number, w = 160, h = 120): string {
  return createElement(
    store.doc,
    newSticky({ x, y, w, h }, DEFAULT_TOOL_STYLE, {
      parentId: null,
      origin: { x: 0, y: 0 },
      createdBy: "u",
    }),
    store.origin,
  );
}

function box(id: string) {
  const el = store.docState.elements.get(id)!;
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

function selected(): string {
  const [id] = store.selection;
  return id;
}

beforeEach(() => {
  resetGridSetting();
  store = new CanvasStore(1, "write", "u");
  store.viewport = { w: 1440, h: 900 };
});

afterEach(() => {
  store.destroy();
  resetGridSetting();
});

describe("with the grid on", () => {
  beforeEach(() => setGridSetting({ show: true }));

  test("a dragged element's corner lands on a grid line", () => {
    const id = sticky(0, 0);
    store.setSelection([id]);
    drag("select", { x: 50, y: 50 }, { x: 87, y: 71 });
    // At 100% the step is 16. x: the left edge (37) is 5 from 32. y: the
    // bottom edge (141) is 3 from 144, nearer than the top's 5 from 16.
    expect(box(id)).toEqual({ x: 32, y: 24, w: 160, h: 120 });
  });

  test("mid-drag, the caught grid lines and the top-left show as guides", () => {
    const id = sticky(0, 0);
    store.setSelection([id]);
    const c = ctx("select");
    const g = beginGesture(c, pointer(), { x: 50, y: 50 })!;
    moveGesture(c, g, pointer(), { x: 87, y: 71 });
    expect(store.guides).toEqual([
      { kind: "grid", axis: "x", at: 32, from: -8, to: 176, marks: [24, 144] },
      { kind: "grid", axis: "y", at: 144, from: 0, to: 224, marks: [32, 192] },
      { kind: "position", x: 32, y: 24 },
    ]);
    endGesture(c, g, pointer(), { x: 87, y: 71 });
    expect(store.guides).toEqual([]);
  });

  test("cmd/ctrl turns snapping off", () => {
    const id = sticky(0, 0);
    store.setSelection([id]);
    drag("select", { x: 50, y: 50 }, { x: 87, y: 71 }, { meta: true });
    expect(box(id)).toEqual({ x: 37, y: 21, w: 160, h: 120 });
  });

  test("an element guide wins when it's closer than the grid line", () => {
    const id = sticky(0, 0);
    sticky(300, 0, 100, 100);
    store.setSelection([id]);
    // The right edge reaches 299: 1 from the other sticky's left edge at 300,
    // while both edges are 5 from a grid line.
    drag("select", { x: 50, y: 50 }, { x: 189, y: 50 });
    expect(box(id).x).toBe(140);
  });

  test("a resize handle lands on a grid line", () => {
    const id = sticky(0, 0);
    store.setSelection([id]);
    drag("select", { x: 160, y: 120 }, { x: 205, y: 133 });
    // The corner (205, 133) goes to (208, 128).
    expect(box(id)).toEqual({ x: 0, y: 0, w: 208, h: 128 });
  });

  test("a drawn rectangle starts and ends on grid lines", () => {
    // From (13, 13) to (101, 77): (16, 16) to (96, 80).
    drag("rect", { x: 13, y: 13 }, { x: 101, y: 77 });
    expect(box(selected())).toEqual({ x: 16, y: 16, w: 80, h: 64 });
  });

  test("drawing with cmd/ctrl held doesn't snap", () => {
    drag("rect", { x: 13, y: 13 }, { x: 101, y: 77 }, { meta: true });
    expect(box(selected())).toEqual({ x: 13, y: 13, w: 88, h: 64 });
  });

  test("a click-placed shape's edges go onto the grid", () => {
    drag("rect", { x: 13, y: 13 }, { x: 13, y: 13 });
    // Centred on (16, 16) at its 160×120 default, the box spans -64..96 and
    // -44..76; the top edge is 4 from -48 (tied with the bottom's 4 from 80).
    expect(box(selected())).toEqual({ x: -64, y: -48, w: 160, h: 120 });
  });

  test("zoomed out, snapping uses the coarser step that's drawn", () => {
    // 25%: a 64-unit grid, and the 6px threshold is 24 units. Screen 14 →
    // world 56 → 64; screen 30 → 120 → 128.
    store.setCamera({ x: 0, y: 0, z: 0.25 });
    drag("rect", { x: 14, y: 14 }, { x: 30, y: 30 });
    expect(box(selected())).toEqual({ x: 64, y: 64, w: 64, h: 64 });
  });

  test("a free line end lands on the grid", () => {
    drag("line", { x: 13, y: 13 }, { x: 203, y: 99 });
    const el = store.docState.elements.get(selected())!;
    expect(el.start).toEqual({ kind: "point", x: 16, y: 16 });
    expect(el.end).toEqual({ kind: "point", x: 208, y: 96 });
  });

  test("with snapping turned off, the grid shows and nothing snaps to it", () => {
    setGridSetting({ snap: false });
    drag("rect", { x: 13, y: 13 }, { x: 101, y: 77 });
    expect(box(selected())).toEqual({ x: 13, y: 13, w: 88, h: 64 });
  });
});

describe("with the grid off", () => {
  test("drags and drawing don't snap to it", () => {
    const id = sticky(0, 0);
    store.setSelection([id]);
    drag("select", { x: 50, y: 50 }, { x: 87, y: 71 });
    expect(box(id)).toEqual({ x: 37, y: 21, w: 160, h: 120 });
    drag("rect", { x: 413, y: 413 }, { x: 501, y: 477 });
    expect(box(selected())).toEqual({ x: 413, y: 413, w: 88, h: 64 });
  });
});
