import { expect, test } from "bun:test";

import { canvasPath, isCanvasPath } from "./route";

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
