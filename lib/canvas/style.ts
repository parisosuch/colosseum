// The canvas's style vocabulary. Elements store token names, never colours, so
// drawings follow light and dark mode; this maps the names to CSS and lists the
// choices the tools and the properties panel offer. The tokens themselves are
// the `canvas · explore` collection in globals.css.

// Ink: strokes, lines, pen and text.
export const INKS = ["foreground", "gray", "red", "amber", "green", "blue", "violet"] as const;
export type Ink = (typeof INKS)[number];

// Fills for shapes and stickies: the sticky-note tokens, or nothing.
export const FILLS = ["none", "yellow", "pink", "blue", "green"] as const;
export type Fill = (typeof FILLS)[number];

export const STICKY_FILLS = ["yellow", "pink", "blue", "green"] as const;

// Frames add the card surface, which is what a new frame starts with.
export const FRAME_FILLS = ["card", "none", "yellow", "pink", "blue", "green"] as const;

export const HIGHLIGHT = "highlight-yellow";

export const STROKE_WIDTHS = [2, 4, 8] as const;

// The highlighter's widths are the pen's times this, so "2 4 8" reads the same
// in both option bars.
export const HIGHLIGHT_WIDTH_SCALE = 5;

export const FONT_SIZES = ["12", "14", "16", "20", "24", "32", "48", "64"] as const;

export const WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;
export type Weight = keyof typeof WEIGHTS;

export const ALIGNS = ["left", "center", "right"] as const;
export type Align = (typeof ALIGNS)[number];

export const HEADS = ["none", "arrow", "triangle", "circle", "bar"] as const;
export type Head = (typeof HEADS)[number];

export const ROUTINGS = ["straight", "elbow"] as const;

export const DEFAULT_STYLE = {
  stroke: "foreground" as Ink,
  fill: "none" as Fill,
  stickyFill: "yellow" as (typeof STICKY_FILLS)[number],
  width: 2,
  fontSize: "16",
  weight: "regular" as Weight,
  align: "left" as Align,
};

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function inkCss(name: unknown): string {
  if (name === HIGHLIGHT) return "hsl(var(--highlight-yellow) / var(--highlight-alpha))";
  const ink = oneOf(INKS, name, "foreground");
  return ink === "foreground" ? "hsl(var(--foreground))" : `hsl(var(--ink-${ink}))`;
}

// Null for "none": the caller leaves the shape unfilled.
export function fillCss(name: unknown): string | null {
  if (name === "card") return "hsl(var(--card))";
  const fill = oneOf(FILLS, name, "none");
  return fill === "none" ? null : `hsl(var(--sticky-${fill}))`;
}

export function fontSizePx(name: unknown): number {
  const n = Number(name);
  return Number.isFinite(n) && n >= 4 && n <= 512 ? n : 16;
}

export function weightValue(name: unknown): number {
  return WEIGHTS[oneOf(Object.keys(WEIGHTS) as Weight[], name, "regular")];
}

export function alignValue(name: unknown): Align {
  return oneOf(ALIGNS, name, "left");
}

export function headValue(name: unknown): Head {
  return oneOf(HEADS, name, "none");
}

export function clampOpacity(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}
