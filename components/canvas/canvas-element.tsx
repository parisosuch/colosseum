"use client";

import { memo, useMemo } from "react";

import type { Rect } from "@/lib/canvas/camera";
import { headInset, headPath, routePath } from "@/lib/canvas/connectors";
import type { ElementSnapshot } from "@/lib/canvas/elements";
import type { Geom } from "@/lib/canvas/layout";
import { strokePath } from "@/lib/canvas/pen";
import {
  alignValue,
  fillCss,
  fontSizePx,
  headValue,
  inkCss,
  weightValue,
} from "@/lib/canvas/style";
import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { CanvasBlock } from "./canvas-block";
import { TEXT_LINE_HEIGHT } from "./measure-text";

// Padding inside a sticky note, in world units: the design's 10px at 50%.
export const STICKY_PADDING = 20;
export const STICKY_FONT_SIZE = 16;

// A clip rect (world space) as a clip-path on an element whose box starts at
// `rect`: the part of a child that's outside its frame isn't drawn.
function clipPath(clip: Rect | null, rect: Rect): string | undefined {
  if (!clip) return undefined;
  const l = clip.x - rect.x;
  const t = clip.y - rect.y;
  const r = l + clip.w;
  const b = t + clip.h;
  return `polygon(${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px)`;
}

// One element on the board, in world space. Everything is drawn in paint
// order as siblings, so blocks, shapes, ink and text stack exactly as their z
// says, and a frame's children are clipped to it with a clip-path.
export const CanvasElement = memo(function CanvasElement({
  el,
  geom,
  column,
  screenshot,
  faded,
  editing,
}: {
  el: ElementSnapshot;
  geom: Geom;
  column?: Column | null;
  screenshot?: ColumnScreenshot;
  // About to be erased.
  faded?: boolean;
  // Being typed in: the editor draws the text instead.
  editing?: boolean;
}) {
  const rect = geom.rect;
  const style: React.CSSProperties = {
    transform: `translate(${rect.x}px, ${rect.y}px)`,
    // A zero-size SVG paints nothing, overflow or not: a level line has no
    // height.
    width: Math.max(1, rect.w),
    height: Math.max(1, rect.h),
    clipPath: clipPath(geom.clip, rect),
    opacity: (faded ? 0.25 : 1) * (el.type === "block" || el.type === "frame" ? 1 : el.opacity),
  };
  const base = "pointer-events-none absolute left-0 top-0 select-none";

  switch (el.type) {
    case "block":
      if (el.columnId == null) return null;
      return (
        <div className={base} style={style}>
          <CanvasBlock
            rect={{ x: 0, y: 0, w: rect.w, h: rect.h }}
            column={column}
            screenshot={screenshot}
          />
        </div>
      );
    case "frame": {
      const fill = fillCss(el.fill ?? "card");
      return (
        <div
          className={`${base} rounded-lg border`}
          style={{ ...style, backgroundColor: fill ?? "transparent" }}
        />
      );
    }
    case "rect":
    case "ellipse":
    case "diamond":
      return (
        <svg className={`${base} overflow-visible`} style={style} width={rect.w} height={rect.h}>
          <ShapeOutline el={el} w={rect.w} h={rect.h} />
        </svg>
      );
    case "stroke":
      return <Stroke el={el} style={style} className={base} />;
    case "line":
    case "arrow":
      return <Connector el={el} geom={geom} style={style} className={base} />;
    case "text":
      return (
        <div
          className={base}
          style={{
            ...style,
            visibility: editing ? "hidden" : undefined,
            color: inkCss(el.stroke),
            fontSize: fontSizePx(el.fontSize),
            fontWeight: weightValue(el.weight),
            textAlign: alignValue(el.align),
            lineHeight: TEXT_LINE_HEIGHT,
            whiteSpace: el.autoSize ? "pre" : "pre-wrap",
            overflowWrap: "break-word",
          }}
        >
          {el.text}
        </div>
      );
    case "sticky":
      return (
        <div
          className={`${base} overflow-hidden rounded`}
          style={{
            ...style,
            backgroundColor: fillCss(el.fill ?? "yellow") ?? undefined,
            color: "hsl(var(--foreground))",
            padding: STICKY_PADDING,
            fontSize: STICKY_FONT_SIZE,
            lineHeight: TEXT_LINE_HEIGHT,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
          }}
        >
          <span style={{ visibility: editing ? "hidden" : undefined }}>{el.text}</span>
        </div>
      );
    case "group":
      return null;
  }
});

function ShapeOutline({ el, w, h }: { el: ElementSnapshot; w: number; h: number }) {
  const props = {
    fill: fillCss(el.fill) ?? "none",
    stroke: inkCss(el.stroke),
    strokeWidth: el.width,
    strokeLinejoin: "round" as const,
  };
  if (el.type === "ellipse")
    return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...props} />;
  if (el.type === "diamond") {
    return <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} {...props} />;
  }
  return <rect x={0} y={0} width={w} height={h} rx={Math.min(8, w / 4, h / 4)} {...props} />;
}

function Stroke({
  el,
  style,
  className,
}: {
  el: ElementSnapshot;
  style: React.CSSProperties;
  className: string;
}) {
  const d = useMemo(
    () => strokePath(el.points ?? [], el.width, el.kind ?? "pen"),
    [el.points, el.width, el.kind],
  );
  return (
    <svg className={`${className} overflow-visible`} style={style} width={1} height={1}>
      <path d={d} fill={inkCss(el.stroke)} />
    </svg>
  );
}

function Connector({
  el,
  geom,
  style,
  className,
}: {
  el: ElementSnapshot;
  geom: Geom;
  style: React.CSSProperties;
  className: string;
}) {
  const pts = (geom.route ?? []).map((p) => ({ x: p.x - geom.rect.x, y: p.y - geom.rect.y }));
  if (pts.length < 2) return null;
  const startHead = el.type === "arrow" ? headValue(el.startHead) : "none";
  const endHead = el.type === "arrow" ? headValue(el.endHead ?? "arrow") : "none";
  const color = inkCss(el.stroke);
  const heads = [
    headPath(startHead, pts[0], pts[1], el.width),
    headPath(endHead, pts[pts.length - 1], pts[pts.length - 2], el.width),
  ];
  return (
    <svg className={`${className} overflow-visible`} style={style} width={1} height={1}>
      <path
        d={routePath(pts, headInset(startHead, el.width), headInset(endHead, el.width))}
        fill="none"
        stroke={color}
        strokeWidth={el.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {heads.map((h, i) =>
        h ? (
          <path
            key={i}
            d={h.d}
            fill={h.fill ? color : "none"}
            stroke={color}
            strokeWidth={el.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null,
      )}
    </svg>
  );
}
