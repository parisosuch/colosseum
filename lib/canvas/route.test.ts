import { describe, expect, test } from "bun:test";

import { canvasPath, canvasThreadHref, isCanvasPath, threadParam } from "./route";

test("canvas paths", () => {
  expect(canvasPath("/alice/12")).toBe("/alice/12/canvas");
  expect(canvasPath("/alice/12/")).toBe("/alice/12/canvas");
  expect(isCanvasPath("/alice/12/canvas")).toBe(true);
  expect(isCanvasPath("/alice/12/canvas/")).toBe(true);
  // A block page and the channel page keep their chrome.
  expect(isCanvasPath("/alice/12/34")).toBe(false);
  expect(isCanvasPath("/alice/12")).toBe(false);
  expect(isCanvasPath("/alice/canvas")).toBe(false);
  expect(isCanvasPath(null)).toBe(false);
});

describe("the ?thread= link", () => {
  test("threadParam takes a positive whole number and nothing else", () => {
    expect(threadParam("42")).toBe(42);
    expect(threadParam(["7", "8"])).toBe(7);
    for (const bad of [undefined, null, "", "0", "-3", "4.5", "1e3", "abc", "12x", " 5"]) {
      expect(threadParam(bad)).toBeNull();
    }
    expect(threadParam("9".repeat(16))).toBeNull();
  });

  test("canvasThreadHref sends the channel link on to the canvas", () => {
    expect(canvasThreadHref("/alice/12", 42)).toBe("/alice/12/canvas?thread=42");
    expect(canvasThreadHref("/alice/12/", 42)).toBe("/alice/12/canvas?thread=42");
  });
});
