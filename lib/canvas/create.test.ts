import { describe, expect, test } from "bun:test";
import * as Y from "yjs";

import { elementsOf } from "@/lib/realtime/canvas-doc";
import {
  clickRect,
  DEFAULT_TOOL_STYLE,
  dragRect,
  newConnector,
  newFrame,
  newShape,
  newSticky,
  newStroke,
  newText,
  nextFrameName,
} from "./create";
import { createElement, readElements } from "./elements";
import { realPressure, scalePoints, strokeFromInput, strokePath } from "./pen";

const here = { parentId: null, origin: { x: 0, y: 0 }, createdBy: "me" };

describe("element creation", () => {
  test("drag boxes, square with shift, growing away from the start", () => {
    expect(dragRect({ x: 10, y: 10 }, { x: 0, y: 40 }, false)).toEqual({
      x: 0,
      y: 10,
      w: 10,
      h: 30,
    });
    expect(dragRect({ x: 10, y: 10 }, { x: 0, y: 40 }, true)).toEqual({
      x: -20,
      y: 10,
      w: 30,
      h: 30,
    });
    expect(clickRect("sticky", { x: 0, y: 0 })).toEqual({ x: -112, y: -112, w: 224, h: 224 });
  });

  test("every tool's element carries the base fields and its style", () => {
    const doc = new Y.Doc();
    const ids = [
      createElement(
        doc,
        newShape(
          "diamond",
          { x: 0, y: 0, w: 10, h: 10 },
          { ...DEFAULT_TOOL_STYLE, stroke: "red" },
          here,
        ),
        {},
      ),
      createElement(doc, newSticky({ x: 0, y: 0, w: 10, h: 10 }, DEFAULT_TOOL_STYLE, here), {}),
      createElement(doc, newText({ x: 0, y: 100 }, DEFAULT_TOOL_STYLE, here), {}),
      createElement(doc, newFrame({ x: 0, y: 0, w: 10, h: 10 }, "Frame 1", here), {}),
      createElement(
        doc,
        newStroke(
          { x: 0, y: 0, w: 5, h: 5 },
          [0, 0, 0.5, 5, 5, 0.5],
          "highlighter",
          DEFAULT_TOOL_STYLE,
          here,
        ),
        {},
      ),
      createElement(
        doc,
        newConnector(
          "arrow",
          { kind: "point", x: 0, y: 0 },
          { kind: "point", x: 9, y: 9 },
          DEFAULT_TOOL_STYLE,
          here,
        ),
        {},
      ),
    ];
    const all = readElements(doc);
    for (const id of ids) {
      const m = elementsOf(doc).get(id)!;
      for (const k of [
        "type",
        "x",
        "y",
        "w",
        "h",
        "rotation",
        "parentId",
        "z",
        "name",
        "locked",
        "hidden",
        "createdBy",
      ]) {
        expect(m.has(k)).toBe(true);
      }
    }
    expect(all.get(ids[0])).toMatchObject({ type: "diamond", stroke: "red", fill: "none" });
    expect(elementsOf(doc).get(ids[1])!.get("text")).toBeInstanceOf(Y.Text);
    expect(all.get(ids[2])).toMatchObject({
      type: "text",
      autoSize: true,
      fontSize: "16",
      text: "",
    });
    expect(all.get(ids[3])).toMatchObject({ type: "frame", name: "Frame 1", fill: "card" });
    expect(all.get(ids[4])).toMatchObject({
      kind: "highlighter",
      stroke: "highlight-yellow",
      width: 4,
    });
    expect(all.get(ids[5])).toMatchObject({
      type: "arrow",
      startHead: "none",
      endHead: "arrow",
      routing: "straight",
    });
    // Each new element goes on top.
    const zs = ids.map((id) => all.get(id)!.z);
    expect([...zs].sort()).toEqual(zs);
  });

  test("an element made inside a frame is placed relative to it", () => {
    const doc = new Y.Doc();
    const id = createElement(
      doc,
      newShape("rect", { x: 150, y: 150, w: 10, h: 10 }, DEFAULT_TOOL_STYLE, {
        parentId: "f",
        origin: { x: 100, y: 100 },
        createdBy: "me",
      }),
      {},
    );
    expect(readElements(doc).get(id)).toMatchObject({ x: 50, y: 50, parentId: "f" });
  });

  test("frame names count up", () => {
    expect(nextFrameName([])).toBe("Frame 1");
    expect(
      nextFrameName([
        { type: "frame", name: "Frame 4" },
        { type: "rect", name: null },
      ]),
    ).toBe("Frame 5");
    expect(nextFrameName([{ type: "frame", name: "Moodboard" }])).toBe("Frame 2");
  });
});

describe("pen", () => {
  test("input is rounded, relative to a whole-pixel box, with duplicates dropped", () => {
    const s = strokeFromInput([
      { x: 10.26, y: 20.04, pressure: 0.5 },
      { x: 10.27, y: 20.04, pressure: 0.5 },
      { x: 30.5, y: 25.55, pressure: 0.734 },
    ])!;
    expect(s.box).toEqual({ x: 10, y: 20, w: 21, h: 6 });
    expect(s.points).toEqual([0.3, 0, 0.5, 20.5, 5.6, 0.73]);
  });

  test("real pressure is told apart from a mouse's constant", () => {
    expect(realPressure([0, 0, 0.5, 1, 1, 0.5])).toBe(false);
    expect(realPressure([0, 0, 0.2, 1, 1, 0.6])).toBe(true);
  });

  test("the outline is an SVG path; highlighter strokes are wider", () => {
    const pts = [0, 0, 0.5, 50, 0, 0.5, 100, 0, 0.5];
    const pen = strokePath(pts, 2, "pen");
    const hl = strokePath(pts, 2, "highlighter");
    expect(pen.startsWith("M")).toBe(true);
    expect(pen.endsWith("Z")).toBe(true);
    const height = (d: string) => {
      const ys = d
        .replace(/[MQZ]/g, " ")
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((_, i) => i % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(height(hl)).toBeGreaterThan(height(pen));
  });

  test("scaling points", () => {
    expect(scalePoints([10, 10, 0.5], { w: 10, h: 10 }, { w: 20, h: 5 })).toEqual([20, 5, 0.5]);
  });
});
