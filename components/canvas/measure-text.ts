// Sizing text elements to what they say. A text element's width follows its
// longest line until someone resizes it by hand (`autoSize` false), and its
// height always follows its lines. The client that makes an edit measures and
// writes the new size in the same transaction, so everyone draws the box the
// writer saw.

import * as Y from "yjs";

import { fontSizePx, weightValue } from "@/lib/canvas/style";

export const TEXT_LINE_HEIGHT = 1.4;

let probe: HTMLDivElement | null = null;

function measurer(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  if (probe && probe.isConnected) return probe;
  probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, {
    position: "absolute",
    left: "-100000px",
    top: "0",
    visibility: "hidden",
    pointerEvents: "none",
    lineHeight: String(TEXT_LINE_HEIGHT),
    padding: "0",
    margin: "0",
    border: "0",
    overflowWrap: "break-word",
  });
  document.body.appendChild(probe);
  return probe;
}

// The box a text needs. With `width` it wraps to that width and only the
// height is measured.
export function measureText(
  text: string,
  fontSize: unknown,
  weight: unknown,
  width?: number,
): { w: number; h: number } {
  const size = fontSizePx(fontSize);
  const lineH = Math.ceil(size * TEXT_LINE_HEIGHT);
  const el = measurer();
  if (!el) {
    const lines = text.split("\n");
    return {
      w: width ?? Math.max(2, ...lines.map((l) => l.length * size * 0.55)),
      h: Math.max(1, lines.length) * lineH,
    };
  }
  el.style.fontSize = `${size}px`;
  el.style.fontWeight = String(weightValue(weight));
  el.style.whiteSpace = width === undefined ? "pre" : "pre-wrap";
  el.style.width = width === undefined ? "auto" : `${width}px`;
  // A trailing newline needs something after it to take up a line.
  el.textContent = text.endsWith("\n") || text === "" ? `${text}​` : text;
  const rect = el.getBoundingClientRect();
  return {
    w: width ?? Math.max(2, Math.ceil(rect.width) + 1),
    h: Math.max(lineH, Math.ceil(rect.height)),
  };
}

// Re-measure text elements and write their size. Run inside the transaction
// that changed them.
export function fitTextElements(elements: Y.Map<Y.Map<unknown>>, ids: Iterable<string>): void {
  for (const id of ids) {
    const m = elements.get(id);
    if (!m || m.get("type") !== "text") continue;
    const t = m.get("text");
    const text = t instanceof Y.Text ? t.toString() : "";
    const auto = m.get("autoSize") === true;
    const w = m.get("w");
    const size = measureText(
      text,
      m.get("fontSize"),
      m.get("weight"),
      auto ? undefined : typeof w === "number" ? w : undefined,
    );
    if (auto && m.get("w") !== size.w) m.set("w", size.w);
    if (m.get("h") !== size.h) m.set("h", size.h);
  }
}
