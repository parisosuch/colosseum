"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Grid3x3, Grip } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DEFAULT_GRID,
  GRID_KEYS,
  GRID_STYLES,
  gridKeyAction,
  gridOffset,
  gridStep,
  halfStepOpacity,
  nextGridSetting,
  type GridSetting,
  type GridStyle,
} from "@/lib/canvas/grid";
import { cn } from "@/lib/utils";
import type { CanvasStore } from "./canvas-store";
import { getGridSetting, setGridSetting, subscribeGridSetting } from "./grid-setting";

// The server renders the grid off; the client's own setting replaces it after
// hydration.
export function useGridSetting(): GridSetting {
  return useSyncExternalStore(subscribeGridSetting, getGridSetting, () => DEFAULT_GRID);
}

// Dot radius and line width, in screen pixels at every zoom: 2px dots and
// 1px lines.
const DOT_RADIUS = 1;
const LINE_WIDTH = 1;

// The grid, drawn behind the world layer in screen space with one SVG pattern.
// It costs the same with one element on the board as with a thousand, and
// stays crisp at any zoom because it's drawn at screen scale instead of
// scaled with the world.
//
// A pan moves the SVG with a transform (by the camera offset modulo one tile),
// so it's a re-composite rather than a repaint; only a zoom touches the
// pattern. Both are written straight to the DOM from the camera subscription,
// like the world layer's transform, so a pan or zoom never renders React.
//
// Also registers the grid's keyboard shortcuts. Mounted on desktop only: on
// a phone the canvas is view-only and there's no grid.
export function CanvasGrid({ store }: { store: CanvasStore }) {
  const { show, style } = useGridSetting();
  return (
    <>
      {show ? <GridLayer store={store} style={style} /> : null}
      <GridShortcuts />
    </>
  );
}

// One tile is one drawn step, s px on screen, laid out in quarters (q = s/4):
// the grid's own mark at (q, q) and the half-step marks at 3q, which fade in
// as the zoom approaches the point where the step halves (halfStepOpacity).
// The pattern starts at -q, so the grid's marks land on multiples of s and the
// half-step ones halfway between. Lines get a half-pixel nudge, so that at a
// whole-pixel spacing (every power-of-two zoom) each one fills a single row
// of pixels instead of blurring across two.
function GridLayer({ store, style }: { store: CanvasStore; style: GridStyle }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const patternRef = useRef<SVGPatternElement | null>(null);
  const mainRef = useRef<SVGPathElement | null>(null);
  const halfRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    let spacing = 0;
    const apply = () => {
      const svg = svgRef.current;
      const pattern = patternRef.current;
      const main = mainRef.current;
      const half = halfRef.current;
      if (!svg || !pattern || !main || !half) return;
      const { camera } = store;
      const s = gridStep(camera.z) * camera.z;
      if (s !== spacing) {
        spacing = s;
        const q = s / 4;
        const nudge = style === "lines" ? 0.5 : 0;
        pattern.setAttribute("x", String(-q + nudge));
        pattern.setAttribute("y", String(-q + nudge));
        pattern.setAttribute("width", String(s));
        pattern.setAttribute("height", String(s));
        if (style === "dots") {
          main.setAttribute("d", dot(q, q));
          half.setAttribute("d", dot(3 * q, q) + dot(q, 3 * q) + dot(3 * q, 3 * q));
        } else {
          main.setAttribute("d", `M ${q} 0 V ${s} M 0 ${q} H ${s}`);
          half.setAttribute("d", `M ${3 * q} 0 V ${s} M 0 ${3 * q} H ${s}`);
        }
        // One tile of slack on each side, so the offset never uncovers an edge.
        svg.style.width = `calc(100% + ${2 * s}px)`;
        svg.style.height = `calc(100% + ${2 * s}px)`;
      }
      half.setAttribute("opacity", String(halfStepOpacity(camera.z)));
      // Whole pixels, so the marks don't shimmer as the board pans.
      const x = Math.round(gridOffset(camera.x, s)) - s;
      const y = Math.round(gridOffset(camera.y, s)) - s;
      svg.style.transform = `translate(${x}px, ${y}px)`;
    };
    apply();
    return store.subscribe("camera", apply);
  }, [store, style]);

  const paint =
    style === "dots"
      ? { fill: "hsl(var(--canvas-grid-dot))" }
      : { stroke: "hsl(var(--canvas-grid-line))", strokeWidth: LINE_WIDTH, fill: "none" };
  return (
    <svg
      ref={svgRef}
      aria-hidden
      data-canvas-grid={style}
      className="pointer-events-none absolute left-0 top-0 will-change-transform"
    >
      <defs>
        <pattern id="canvas-grid" ref={patternRef} patternUnits="userSpaceOnUse">
          <path ref={mainRef} {...paint} />
          <path ref={halfRef} {...paint} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#canvas-grid)" />
    </svg>
  );
}

// A filled circle as a path, so dots and lines share one element.
function dot(cx: number, cy: number) {
  const r = DOT_RADIUS;
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 `;
}

// The grid button in the zoom island and its options: show grid, dots or
// lines, and snap to grid. The button stays pressed while the grid is on, and
// its icon shows the style. Menu rows keep the menu open, so all three can be
// set in one visit; Esc or a click on the board closes it.
export function GridMenu() {
  const { show, style, snap } = useGridSetting();
  const Icon = style === "dots" ? Grip : Grid3x3;
  return (
    <DropdownMenu>
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={show ? "Grid, on" : "Grid, off"}
              className={cn(
                "w-12 gap-0.5 [&>svg:last-child]:size-3",
                show && "bg-secondary hover:bg-secondary/80",
              )}
            >
              <Icon />
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-3">
          <span>Grid</span>
          <span className="font-mono">{GRID_KEYS.show}</span>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" sideOffset={12} className="w-60">
        <DropdownMenuCheckboxItem
          checked={show}
          onCheckedChange={(v) => setGridSetting({ show: v })}
          onSelect={(e) => e.preventDefault()}
          className="gap-4"
        >
          <span className="flex-1">Show grid</span>
          <Key>{GRID_KEYS.show}</Key>
        </DropdownMenuCheckboxItem>
        <div
          className={cn(
            "flex items-center justify-between py-1 pl-8 pr-1 text-sm",
            !show && "opacity-50",
          )}
        >
          <span id="grid-style-label">Style</span>
          <DropdownMenuRadioGroup
            value={style}
            onValueChange={(v) => setGridSetting({ style: v as GridStyle })}
            aria-labelledby="grid-style-label"
            className="flex rounded-lg border p-0.5"
          >
            {GRID_STYLES.map((v) => (
              <DropdownMenuPrimitive.RadioItem
                key={v}
                value={v}
                disabled={!show}
                onSelect={(e) => e.preventDefault()}
                className={cn(
                  "flex h-7 cursor-default select-none items-center rounded-md px-3 outline-none transition-colors duration-micro focus:bg-accent focus:text-foreground",
                  style === v
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "dots" ? "Dots" : "Lines"}
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={snap}
          disabled={!show}
          onCheckedChange={(v) => setGridSetting({ snap: v })}
          onSelect={(e) => e.preventDefault()}
          className="gap-4"
        >
          <span className="flex-1">Snap to grid</span>
          <Key>{GRID_KEYS.snap}</Key>
        </DropdownMenuCheckboxItem>
        <p
          className={cn(
            "pb-1.5 pl-8 pr-2 pt-0.5 text-xs text-muted-foreground",
            !show && "opacity-50",
          )}
        >
          Hold ⌘ to place freely.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs text-muted-foreground">{children}</span>;
}

function isTyping(target: EventTarget | null) {
  const t = target as HTMLElement | null;
  if (!t) return false;
  return (
    t.isContentEditable ||
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT"
  );
}

// A dialog or menu that takes the keyboard; a comment thread's popover
// doesn't. The same rule as the board's other shortcuts.
function dialogOpen() {
  return [
    ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]'),
  ].some((d) => !d.closest("[data-canvas-ui]"));
}

// Registers the grid keys (gridKeyAction) on the document while mounted, and
// announces each change to screen readers.
function GridShortcuts() {
  const [said, setSaid] = useState("");
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isTyping(e.target) || dialogOpen()) return;
      const action = gridKeyAction(e);
      if (!action) return;
      e.preventDefault();
      setGridSetting(nextGridSetting(getGridSetting(), action));
      const next = getGridSetting();
      if (action === "show") setSaid(next.show ? `Grid on, ${next.style}` : "Grid off");
      else setSaid(next.snap ? "Snap to grid on" : "Snap to grid off");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <output aria-live="polite" className="sr-only">
      {said}
    </output>
  );
}
