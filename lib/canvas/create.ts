// What the drawing tools create: the element each tool makes from a click or
// a drag, with the current tool style. Pure, so the shapes can be checked
// without a pointer.

import type { ElementType } from "@/lib/realtime/canvas-doc";
import type { Point, Rect } from "./camera";
import type { NewElement } from "./elements";
import { normalizeRect } from "./geometry";
import { DEFAULT_STYLE, HIGHLIGHT, type Align, type Weight } from "./style";

export type ShapeTool = "rect" | "ellipse" | "diamond";

// Sizes for a click without a drag.
export const DEFAULT_SIZES = {
  rect: { w: 160, h: 120 },
  ellipse: { w: 160, h: 120 },
  diamond: { w: 160, h: 120 },
  frame: { w: 480, h: 360 },
  sticky: { w: 224, h: 224 },
} as const;

// Below this many world units a drag counts as a click.
export const MIN_DRAG = 4;

export type ToolStyle = {
  stroke: string;
  fill: string;
  width: number;
  stickyFill: string;
  fontSize: string;
  weight: Weight;
  align: Align;
  highlightWidth: number;
};

export const DEFAULT_TOOL_STYLE: ToolStyle = {
  stroke: DEFAULT_STYLE.stroke,
  fill: DEFAULT_STYLE.fill,
  width: DEFAULT_STYLE.width,
  stickyFill: DEFAULT_STYLE.stickyFill,
  fontSize: DEFAULT_STYLE.fontSize,
  weight: DEFAULT_STYLE.weight,
  align: DEFAULT_STYLE.align,
  highlightWidth: 4,
};

// The box a drag from `a` to `b` makes. With `square`, the larger side wins
// and the box grows away from `a`.
export function dragRect(a: Point, b: Point, square: boolean): Rect {
  if (!square) return normalizeRect(a, b);
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return normalizeRect(a, {
    x: a.x + Math.sign(b.x - a.x || 1) * side,
    y: a.y + Math.sign(b.y - a.y || 1) * side,
  });
}

// A click places a default-sized element centred on the point.
export function clickRect(type: keyof typeof DEFAULT_SIZES, at: Point): Rect {
  const { w, h } = DEFAULT_SIZES[type];
  return { x: at.x - w / 2, y: at.y - h / 2, w, h };
}

type Placement = { parentId: string | null; origin: Point; createdBy: string };

function placed(rect: Rect, p: Placement) {
  return {
    x: rect.x - p.origin.x,
    y: rect.y - p.origin.y,
    w: Math.max(1, rect.w),
    h: Math.max(1, rect.h),
    parentId: p.parentId,
    createdBy: p.createdBy,
  };
}

export function newShape(type: ShapeTool, rect: Rect, style: ToolStyle, p: Placement): NewElement {
  return {
    type,
    ...placed(rect, p),
    stroke: style.stroke,
    fill: style.fill,
    width: style.width,
    opacity: 1,
  };
}

export function newSticky(rect: Rect, style: ToolStyle, p: Placement): NewElement {
  return { type: "sticky", ...placed(rect, p), text: "", fill: style.stickyFill, opacity: 1 };
}

export function newFrame(rect: Rect, name: string, p: Placement): NewElement {
  return { type: "frame", ...placed(rect, p), name, fill: "card" };
}

// A text element starts empty and sized to one line; its width follows what's
// typed until someone resizes it.
export function newText(at: Point, style: ToolStyle, p: Placement): NewElement {
  const size = Number(style.fontSize) || 16;
  const lineHeight = Math.round(size * 1.4);
  return {
    type: "text",
    ...placed({ x: at.x, y: at.y - lineHeight / 2, w: 2, h: lineHeight }, p),
    text: "",
    fontSize: style.fontSize,
    weight: style.weight,
    align: style.align,
    stroke: style.stroke,
    opacity: 1,
    autoSize: true,
  };
}

export function newStroke(
  box: Rect,
  points: number[],
  kind: "pen" | "highlighter",
  style: ToolStyle,
  p: Placement,
): NewElement {
  return {
    type: "stroke",
    ...placed(box, p),
    points,
    kind,
    stroke: kind === "highlighter" ? HIGHLIGHT : style.stroke,
    width: kind === "highlighter" ? style.highlightWidth : style.width,
    opacity: 1,
  };
}

export function newConnector(
  type: "line" | "arrow",
  start: NewElement["start"],
  end: NewElement["end"],
  style: ToolStyle,
  p: Placement,
): NewElement {
  return {
    type: type as ElementType,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    parentId: p.parentId,
    createdBy: p.createdBy,
    start,
    end,
    stroke: style.stroke,
    width: style.width,
    opacity: 1,
    routing: "straight",
    ...(type === "arrow" ? { startHead: "none", endHead: "arrow" } : {}),
  };
}

// "Frame 3" for the third frame on the canvas: one past the highest numbered
// frame or the frame count, whichever is more.
export function nextFrameName(existing: Iterable<{ type: string; name: string | null }>): string {
  let max = 0;
  let count = 0;
  for (const e of existing) {
    if (e.type !== "frame") continue;
    count++;
    const m = /^Frame (\d+)$/.exec(e.name ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Frame ${Math.max(max, count) + 1}`;
}
