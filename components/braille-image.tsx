"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

// ── Hardcoded settings (the original component's sliders, frozen) ──────────
// ponytail: these are the tuning knobs — the effect is a physical thing on a
// screen, so eyeball them rather than trust the numbers.
const COLS = 52; // horizontal resolution, in Braille cells (lower = coarser)
const FONT_SIZE = 20; // px; drives dot size + overall on-screen size
const WEIGHT = 400;
const INVERT = false;
const DECAY = 0.9; // hover-trail fade per frame (higher = longer trail)

// Threshold slowly breathes between these two, low -> mid -> low, so dots
// wash in and out. PERIOD is one full round trip.
const THRESHOLD_MIN = 80;
const THRESHOLD_MAX = 125;
const THRESHOLD_PERIOD_MS = 6000;
const ANIM_STEP_MS = 60; // how often glyphs are re-derived (throttle DOM churn)

const MONO = "'JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,monospace";

// Braille dot -> bit within a 2-col x 4-row sub-cell, offset from U+2800.
const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

// Resting -> hovered dot color, per theme. Light theme matches the original;
// dark theme flips it so dots stay visible on the near-black background.
const COLORS = {
  light: { base: [208, 208, 208], hover: [18, 18, 18] },
  dark: { base: [64, 64, 64], hover: [235, 235, 235] },
} as const;

// The image the mask renders (served from /public). Swap this one path for a
// different picture. Its transparent background reads as blank cells.
const SRC = "/col-no-bg.png";

type RGB = readonly [number, number, number];
// Per cell: the sub-dots that aren't transparent, each as [bitValue, luminance].
type Cell = Array<[number, number]>;

function rgb([r, g, b]: RGB | number[]) {
  return `rgb(${r},${g},${b})`;
}
function lerpColor(base: RGB, hover: RGB, t: number) {
  return rgb(base.map((c, i) => Math.round(c + (hover[i] - c) * t)));
}
function cellBits(cell: Cell, threshold: number) {
  let bits = 0;
  for (const [bit, lum] of cell) {
    if (INVERT ? lum > threshold : lum < threshold) bits |= bit;
  }
  return bits;
}

export default function BrailleImage() {
  const { resolvedTheme } = useTheme();
  const palette = resolvedTheme === "dark" ? COLORS.dark : COLORS.light;

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [metrics, setMetrics] = useState<{ charW: number; lineH: number } | null>(null);
  const [grid, setGrid] = useState<{ rows: number; cols: number; lines: string[] } | null>(null);

  const probeRef = useRef<HTMLSpanElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<Map<number, number>>(new Map()); // cellIndex -> hover intensity
  const cellsRef = useRef<Cell[] | null>(null); // cached per-cell dot data
  const bitsRef = useRef<Uint16Array | null>(null); // last-rendered glyph bits
  const rafRef = useRef(0);
  // Read latest palette inside the rAF loop without restarting it.
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  // Load the (hardcoded) image once.
  useEffect(() => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => setImg(image);
    image.src = SRC;
  }, []);

  // Measure monospace char metrics.
  useLayoutEffect(() => {
    if (!probeRef.current) return;
    const r = probeRef.current.getBoundingClientRect();
    setMetrics({ charW: r.width / 10, lineH: r.height });
  }, []);

  // Sample the image into per-cell dot data (once per image/metrics). The
  // threshold is applied later, per animation frame, so this is threshold-free.
  useEffect(() => {
    if (!img || !metrics) return;
    const { charW, lineH } = metrics;
    const aspect = img.naturalWidth / img.naturalHeight;
    const rows = Math.max(1, Math.round((COLS * charW) / (aspect * lineH)));

    const sw = COLS * 2;
    const sh = rows * 4;
    const cvs = document.createElement("canvas");
    cvs.width = sw;
    cvs.height = sh;
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, sw, sh);
    const { data } = ctx.getImageData(0, 0, sw, sh);

    const cells: Cell[] = new Array(rows * COLS);
    for (let cr = 0; cr < rows; cr++) {
      for (let cc = 0; cc < COLS; cc++) {
        const dots: Cell = [];
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 2; c++) {
            const i = ((cr * 4 + r) * sw + (cc * 2 + c)) * 4;
            if (data[i + 3] < 128) continue; // transparent -> dot never on
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            dots.push([DOT_BITS[r][c], lum]);
          }
        }
        cells[cr * COLS + cc] = dots;
      }
    }

    // Initial render at the mid threshold.
    const mid = (THRESHOLD_MIN + THRESHOLD_MAX) / 2;
    const bits = new Uint16Array(rows * COLS);
    const lines = new Array<string>(rows);
    for (let cr = 0; cr < rows; cr++) {
      let line = "";
      for (let cc = 0; cc < COLS; cc++) {
        const b = cellBits(cells[cr * COLS + cc], mid);
        bits[cr * COLS + cc] = b;
        line += String.fromCharCode(0x2800 + b);
      }
      lines[cr] = line;
    }

    cellsRef.current = cells;
    bitsRef.current = bits;
    activeRef.current.clear();
    setGrid({ rows, cols: COLS, lines });
  }, [img, metrics]);

  const stepColor = useCallback(
    (idx: number, t: number) => {
      const field = fieldRef.current;
      if (!field || !grid) return;
      const rowEl = field.children[Math.floor(idx / grid.cols)] as HTMLElement | undefined;
      const cell = rowEl?.children[idx % grid.cols] as HTMLElement | undefined;
      if (cell) cell.style.color = lerpColor(paletteRef.current.base, paletteRef.current.hover, t);
    },
    [grid],
  );

  // Single rAF loop: breathe the threshold (re-deriving only changed glyphs)
  // and fade the hover trail. ponytail: always-on while mounted — fine for a
  // hero; gate on document visibility if it ever needs to be frugal.
  useEffect(() => {
    if (!grid) return;
    const field = fieldRef.current;
    if (!field) return;
    let start = 0;
    let lastStep = 0;

    const frame = (now: number) => {
      if (!start) start = now;
      const cells = cellsRef.current;
      const bits = bitsRef.current;

      if (cells && bits && now - lastStep >= ANIM_STEP_MS) {
        const phase = ((now - start) % THRESHOLD_PERIOD_MS) / THRESHOLD_PERIOD_MS;
        const wave = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI); // 0..1..0
        const thr = THRESHOLD_MIN + (THRESHOLD_MAX - THRESHOLD_MIN) * wave;
        for (let idx = 0; idx < cells.length; idx++) {
          const nb = cellBits(cells[idx], thr);
          if (nb !== bits[idx]) {
            bits[idx] = nb;
            const rowEl = field.children[Math.floor(idx / grid.cols)] as HTMLElement | undefined;
            const cell = rowEl?.children[idx % grid.cols] as HTMLElement | undefined;
            if (cell) cell.textContent = String.fromCharCode(0x2800 + nb);
          }
        }
        lastStep = now;
      }

      // hover trail decay
      const active = activeRef.current;
      active.forEach((t, idx) => {
        const nt = t * DECAY;
        if (nt < 0.02) {
          stepColor(idx, 0);
          active.delete(idx);
        } else {
          active.set(idx, nt);
          stepColor(idx, nt);
        }
      });

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [grid, stepColor]);

  // Register hover cells (the loop above consumes them).
  useEffect(() => {
    const field = fieldRef.current;
    if (!field || !grid || !metrics) return;
    const { charW, lineH } = metrics;
    const onMove = (e: MouseEvent) => {
      const rect = field.getBoundingClientRect();
      const col = Math.floor((e.clientX - rect.left) / charW);
      const row = Math.floor((e.clientY - rect.top) / lineH);
      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return;
      activeRef.current.set(row * grid.cols + col, 1);
    };
    field.addEventListener("mousemove", onMove);
    return () => field.removeEventListener("mousemove", onMove);
  }, [grid, metrics]);

  // Re-baseline cell colors when the theme flips (untouched cells inherit the
  // container color; touched ones keep an inline color, so clear those).
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    for (const rowEl of Array.from(field.children)) {
      for (const cell of Array.from(rowEl.children)) {
        (cell as HTMLElement).style.color = "";
      }
    }
    activeRef.current.clear();
  }, [palette, grid]);

  return (
    <div className="relative select-none" aria-hidden>
      {/* hidden probe for measuring char width / line height */}
      <span
        ref={probeRef}
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "pre",
          fontSize: FONT_SIZE,
          fontWeight: WEIGHT,
          lineHeight: 1,
          fontFamily: MONO,
        }}
      >
        {"⠀".repeat(10)}
      </span>

      <div
        ref={fieldRef}
        style={{
          fontSize: FONT_SIZE,
          fontWeight: WEIGHT,
          lineHeight: 1,
          whiteSpace: "pre",
          fontFamily: MONO,
          color: rgb(palette.base),
        }}
      >
        {grid?.lines.map((line, r) => (
          <div key={r}>
            {Array.from(line).map((ch, c) => (
              <span key={c}>{ch}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
