import { describe, expect, test } from "bun:test";

import { BLOCK_CAPTION_HEIGHT, BLOCK_DEFAULT_SIZE } from "./elements";
import {
  PASTE_GAP,
  loneUrl,
  mediaRect,
  readPasteContent,
  rectCenter,
  rowSlots,
  type TransferLike,
} from "./paste-content";

function transfer(data: Record<string, string>, files: File[] = []): TransferLike {
  return {
    types: [...(files.length ? ["Files"] : []), ...Object.keys(data)],
    files,
    getData: (format) => data[format] ?? "",
  };
}

const png = (name = "image.png") => new File([new Uint8Array(4)], name, { type: "image/png" });
const pdf = () => new File([new Uint8Array(4)], "spec.pdf", { type: "application/pdf" });

describe("readPasteContent", () => {
  test("a lone URL is a block, with or without a scheme", () => {
    expect(readPasteContent(transfer({ "text/plain": "https://example.com/a" }))).toEqual({
      kind: "url",
      url: "https://example.com/a",
    });
    expect(readPasteContent(transfer({ "text/plain": "  github.com/vercel/next.js\n" }))).toEqual({
      kind: "url",
      url: "github.com/vercel/next.js",
    });
  });

  test("tweet, YouTube and Spotify links are URLs; the server picks the block type", () => {
    for (const url of [
      "https://x.com/jack/status/20",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      "https://example.com/cat.gif",
    ]) {
      expect(readPasteContent(transfer({ "text/plain": url }))).toEqual({ kind: "url", url });
    }
  });

  test("other text is a text element, trimmed, with CRLF folded", () => {
    expect(readPasteContent(transfer({ "text/plain": "  a note\r\nsecond line  " }))).toEqual({
      kind: "text",
      text: "a note\nsecond line",
    });
    // A sentence with a link in it, or two links, is text.
    expect(readPasteContent(transfer({ "text/plain": "see https://example.com" }))?.kind).toBe(
      "text",
    );
    expect(readPasteContent(transfer({ "text/plain": "https://a.com\nhttps://b.com" }))?.kind).toBe(
      "text",
    );
    // Not a public domain.
    expect(readPasteContent(transfer({ "text/plain": "localhost:3000" }))?.kind).toBe("text");
  });

  test("empty and whitespace-only clipboards give nothing", () => {
    expect(readPasteContent(transfer({}))).toBeNull();
    expect(readPasteContent(transfer({ "text/plain": " \n\t" }))).toBeNull();
  });

  test("files win over the text that comes with them", () => {
    const a = png();
    const b = pdf();
    const got = readPasteContent(transfer({ "text/plain": "image.png" }, [a, b]));
    expect(got).toEqual({ kind: "files", files: [a, b], imageSource: null });
  });

  test("a copied image carries its original's address", () => {
    const a = png();
    const html = '<meta charset="utf-8"><img src="https://cdn.example.com/cat.gif" alt="">';
    expect(readPasteContent(transfer({ "text/html": html }, [a]))).toEqual({
      kind: "files",
      files: [a],
      imageSource: "https://cdn.example.com/cat.gif",
    });
    // Only for a single image: two files upload as they are.
    const two = readPasteContent(transfer({ "text/html": html }, [a, png("b.png")]));
    expect(two?.kind === "files" && two.imageSource).toBeNull();
    // A relative or data: source isn't fetchable.
    const rel = readPasteContent(transfer({ "text/html": '<img src="/cat.gif">' }, [a]));
    expect(rel?.kind === "files" && rel.imageSource).toBeNull();
  });

  test("a dragged link uses its uri-list, not its title", () => {
    const got = readPasteContent(
      transfer({
        "text/uri-list": "# from a tab\r\nhttps://example.com/post\r\n",
        "text/plain": "A post title",
      }),
    );
    expect(got).toEqual({ kind: "url", url: "https://example.com/post" });
    // A non-web uri-list falls back to the text.
    expect(
      readPasteContent(transfer({ "text/uri-list": "file:///tmp/a.txt", "text/plain": "a note" })),
    ).toEqual({ kind: "text", text: "a note" });
  });
});

describe("loneUrl", () => {
  test("one token that is a URL", () => {
    expect(loneUrl(" example.com ")).toBe("example.com");
    expect(loneUrl("example")).toBeNull();
    expect(loneUrl("two words.com")).toBeNull();
    expect(loneUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("rowSlots", () => {
  const { w, h } = BLOCK_DEFAULT_SIZE;

  test("one block is centred on the point", () => {
    const [slot] = rowSlots({ x: 1000, y: 500 }, 1);
    expect(slot).toEqual({ x: 1000 - w / 2, y: 500 - h / 2, w, h });
    expect(rectCenter(slot!)).toEqual({ x: 1000, y: 500 });
  });

  test("several lie in a row with gaps, the row centred on the point", () => {
    const slots = rowSlots({ x: 0, y: 0 }, 3);
    expect(slots).toHaveLength(3);
    for (const s of slots) expect(s.y).toBe(-h / 2);
    expect(slots[1]!.x - slots[0]!.x).toBe(w + PASTE_GAP);
    expect(slots[2]!.x - slots[1]!.x).toBe(w + PASTE_GAP);
    const left = slots[0]!.x;
    const right = slots[2]!.x + w;
    expect((left + right) / 2).toBe(0);
  });

  test("an even count straddles the point", () => {
    const [a, b] = rowSlots({ x: 0, y: 0 }, 2);
    expect(a!.x + w).toBe(-PASTE_GAP / 2);
    expect(b!.x).toBe(PASTE_GAP / 2);
  });

  test("the placeholder covers the media box, not the caption", () => {
    const [slot] = rowSlots({ x: 0, y: 0 }, 1);
    expect(mediaRect(slot!)).toEqual({ ...slot!, h: h - BLOCK_CAPTION_HEIGHT });
  });
});
