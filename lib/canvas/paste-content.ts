// What a paste or a drop from outside the canvas turns into, and where it
// lands. Pure, so it can be checked without a clipboard or a board.
//
// Files win over text: copying an image in a browser also puts its markup
// and its address on the clipboard, and copying a file in Finder puts its
// name there too. A lone URL becomes a block; any other text becomes a text
// element on the canvas and no block.

import { imageSrcFromHtml, isURL } from "@/lib/utils";
import type { Point, Rect } from "./camera";
import { BLOCK_CAPTION_HEIGHT, BLOCK_DEFAULT_SIZE } from "./elements";

// The parts of a DataTransfer this reads. A paste's clipboardData and a
// drop's dataTransfer both fit.
export type TransferLike = {
  readonly types: readonly string[];
  readonly files: ArrayLike<File>;
  getData(format: string): string;
};

export type PasteContent =
  // Files, in clipboard order. `imageSource` is the original of a browser
  // "copy image", fetched instead of the flattened file when there's exactly
  // one image.
  | { kind: "files"; files: File[]; imageSource: string | null }
  | { kind: "url"; url: string }
  | { kind: "text"; text: string };

// A URL on its own: one token, no spaces. Several lines or a sentence with a
// link in it are text.
export function loneUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  return isURL(t) ? t : null;
}

// The first URL of a text/uri-list ("#" lines are comments).
function firstUri(list: string): string | null {
  for (const line of list.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t;
  }
  return null;
}

export function readPasteContent(data: TransferLike): PasteContent | null {
  const files = Array.from(data.files);
  if (files.length > 0) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const imageSource =
      files.length === 1 && images.length === 1 && data.types.includes("text/html")
        ? imageSrcFromHtml(data.getData("text/html"))
        : null;
    return { kind: "files", files, imageSource };
  }
  // A link dragged out of another tab carries text/uri-list, and its
  // text/plain may be the link's title rather than its address.
  const uri = data.types.includes("text/uri-list") ? firstUri(data.getData("text/uri-list")) : null;
  const uriUrl = uri ? loneUrl(uri) : null;
  if (uriUrl && /^https?:/i.test(uriUrl)) return { kind: "url", url: uriUrl };
  const text = data.getData("text/plain");
  if (!text.trim()) return null;
  const url = loneUrl(text);
  if (url) return { kind: "url", url };
  return { kind: "text", text: text.replace(/\r\n?/g, "\n").trim() };
}

// The gap between blocks pasted or dropped together, in world units.
export const PASTE_GAP = 32;

// Where `count` blocks pasted together land: a row of block-sized slots whose
// middle is `at`. Each slot is a whole block element, caption included.
export function rowSlots(at: Point, count: number, gap = PASTE_GAP): Rect[] {
  const { w, h } = BLOCK_DEFAULT_SIZE;
  const total = count * w + Math.max(0, count - 1) * gap;
  const left = at.x - total / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: Math.round(left + i * (w + gap)),
    y: Math.round(at.y - h / 2),
    w,
    h,
  }));
}

// The media box inside a slot, where the upload placeholder draws: the slot
// without its caption lines.
export function mediaRect(slot: Rect): Rect {
  return { ...slot, h: Math.max(0, slot.h - BLOCK_CAPTION_HEIGHT) };
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Pasted text wider than this wraps instead of running on as one line.
export const PASTED_TEXT_MAX_WIDTH = 640;
