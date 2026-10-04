"use client";

import { FILLS, INKS, STICKY_FILLS, STROKE_WIDTHS } from "@/lib/canvas/style";
import { Island } from "./canvas-chrome";
import type { CanvasStore } from "./canvas-store";
import { FillSwatches, InkSwatches, Segmented } from "./controls";
import type { Tool } from "./tools";
import { useCanvas } from "./use-canvas";

const WIDTHS = STROKE_WIDTHS.map((w) => ({ value: w, label: String(w), title: `${w}px` }));

// Options for the drawing tool in hand, floating above the toolbar while it's
// picked: colour and width for the pen, lines and shapes, width for the
// highlighter, ink for text and the note colour for stickies. They apply to
// what's drawn next and last for the session.
export function ToolOptions({ store, tool }: { store: CanvasStore; tool: Tool }) {
  const style = useCanvas(store, "style", (s) => s.toolStyle);
  const set = store.setToolStyle.bind(store);

  let body: React.ReactNode = null;
  switch (tool) {
    case "pen":
    case "line":
    case "arrow":
      body = (
        <>
          <InkSwatches values={INKS} value={style.stroke} onChange={(stroke) => set({ stroke })} />
          <Divider />
          <Segmented
            label="Stroke width"
            options={WIDTHS}
            value={style.width}
            onChange={(width) => set({ width })}
            mono
          />
        </>
      );
      break;
    case "rect":
    case "ellipse":
    case "diamond":
      body = (
        <>
          <InkSwatches values={INKS} value={style.stroke} onChange={(stroke) => set({ stroke })} />
          <Divider />
          <FillSwatches values={FILLS} value={style.fill} onChange={(fill) => set({ fill })} />
          <Divider />
          <Segmented
            label="Stroke width"
            options={WIDTHS}
            value={style.width}
            onChange={(width) => set({ width })}
            mono
          />
        </>
      );
      break;
    case "highlighter":
      body = (
        <Segmented
          label="Highlighter width"
          options={WIDTHS}
          value={style.highlightWidth}
          onChange={(highlightWidth) => set({ highlightWidth })}
          mono
        />
      );
      break;
    case "text":
      body = (
        <InkSwatches values={INKS} value={style.stroke} onChange={(stroke) => set({ stroke })} />
      );
      break;
    case "sticky":
      body = (
        <FillSwatches
          values={STICKY_FILLS}
          value={style.stickyFill}
          onChange={(stickyFill) => set({ stickyFill })}
        />
      );
      break;
    default:
      return null;
  }
  return (
    <Island role="group" aria-label="Tool options" className="gap-3 px-3 py-1.5">
      {body}
    </Island>
  );
}

function Divider() {
  return <span aria-hidden className="h-5 w-px shrink-0 bg-border" />;
}
