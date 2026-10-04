"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import * as Y from "yjs";

import { createElement, removeElements } from "@/lib/canvas/elements";
import { newText } from "@/lib/canvas/create";
import { alignValue, fontSizePx, inkCss, weightValue } from "@/lib/canvas/style";
import { elementsOf } from "@/lib/realtime/canvas-doc";
import type { CanvasStore } from "./canvas-store";
import { STICKY_FONT_SIZE, STICKY_PADDING } from "./canvas-element";
import { fitTextElements, measureText, TEXT_LINE_HEIGHT } from "./measure-text";
import { useCanvas } from "./use-canvas";

// Where an index ends up after a Yjs text change, so someone else's typing
// doesn't move this person's caret.
function shiftIndex(
  index: number,
  delta: readonly { insert?: unknown; delete?: number; retain?: number }[],
) {
  let pos = 0;
  let out = index;
  for (const op of delta) {
    if (op.retain) pos += op.retain;
    else if (typeof op.insert === "string") {
      if (pos <= index) out += op.insert.length;
      pos += op.insert.length;
    } else if (op.delete) {
      if (pos < index) out -= Math.min(op.delete, index - pos);
    }
  }
  return Math.max(0, out);
}

// Typing in a text element or sticky note. A textarea sits over the element
// in world space, with the element's font, and every keystroke is applied to
// the element's Y.Text as the smallest insert and delete that explains it, so
// two people typing in one note merge instead of overwriting each other. A new
// text element isn't written until its first character, and one left empty is
// removed when editing ends.
export function TextEditor({ store }: { store: CanvasStore }) {
  const editing = useCanvas(store, "editing", (s) => s.editing);
  const doc = useCanvas(store, "doc", (s) => s.docState);
  const style = useCanvas(store, "style", (s) => s.toolStyle);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const idRef = useRef<string | null>(null);

  const id = editing && "id" in editing ? editing.id : null;
  const draft = editing && "draft" in editing ? editing.draft : null;
  idRef.current = id;
  const el = id ? doc.elements.get(id) : undefined;
  const geom = id ? doc.layout.geom.get(id) : undefined;

  const ytext = (): Y.Text | null => {
    const cur = idRef.current;
    const t = cur ? elementsOf(store.doc).get(cur)?.get("text") : null;
    return t instanceof Y.Text ? t : null;
  };

  // Focus once, caret at the end.
  const focusedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const ta = ref.current;
    const key = id ?? (draft ? "draft" : null);
    if (!ta || !key || focusedFor.current === key) return;
    if (focusedFor.current === "draft" && id) {
      focusedFor.current = id;
      return;
    }
    focusedFor.current = key;
    ta.value = ytext()?.toString() ?? "";
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });

  // Someone else's typing.
  useEffect(() => {
    const t = ytext();
    if (!t) return;
    const onChange = (event: Y.YTextEvent, tr: Y.Transaction) => {
      const ta = ref.current;
      if (!ta || tr.origin === store.origin) return;
      const start = shiftIndex(ta.selectionStart, event.delta as never);
      const end = shiftIndex(ta.selectionEnd, event.delta as never);
      ta.value = t.toString();
      ta.setSelectionRange(start, end);
    };
    t.observe(onChange);
    return () => t.unobserve(onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the Y.Text is looked up by id; `ytext` reads the current one.
  }, [id, store]);

  if (!editing) return null;
  if (id && (!el || !geom)) return null;

  const finish = () => {
    const cur = idRef.current;
    store.setEditing(null);
    focusedFor.current = null;
    if (!cur) return;
    const snap = store.docState.elements.get(cur);
    if (snap?.type === "text" && !(snap.text ?? "").trim()) {
      removeElements(store.doc, [cur], store.origin, undefined, store.docState);
      store.setSelection([]);
    } else {
      store.setSelection([cur]);
    }
    store.undo.stopCapturing();
    document
      .querySelector<HTMLElement>('[aria-roledescription="canvas"]')
      ?.focus({ preventScroll: true });
  };

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const value = e.currentTarget.value;
    if (!idRef.current && draft) {
      if (!value) return;
      const created = createElement(
        store.doc,
        newText({ x: draft.at.x, y: draft.at.y }, store.toolStyle, {
          parentId: draft.parentId,
          origin: draft.parentOrigin,
          createdBy: store.userId,
        }),
        store.origin,
        store.docState,
      );
      idRef.current = created;
      const t = ytext()!;
      store.doc.transact(() => {
        t.insert(0, value);
        fitTextElements(elementsOf(store.doc), [created]);
      }, store.origin);
      store.setSelection([created]);
      store.setEditing({ id: created });
      return;
    }
    const t = ytext();
    const cur = idRef.current;
    if (!t || !cur) return;
    const old = t.toString();
    let start = 0;
    while (start < old.length && start < value.length && old[start] === value[start]) start++;
    let endOld = old.length;
    let endNew = value.length;
    while (endOld > start && endNew > start && old[endOld - 1] === value[endNew - 1]) {
      endOld--;
      endNew--;
    }
    store.doc.transact(() => {
      if (endOld > start) t.delete(start, endOld - start);
      if (endNew > start) t.insert(start, value.slice(start, endNew));
      fitTextElements(elementsOf(store.doc), [cur]);
    }, store.origin);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      finish();
    }
    // The board's shortcuts don't see keys typed here.
    e.stopPropagation();
  };

  const sticky = el?.type === "sticky";
  let box: { x: number; y: number; w: number; h: number };
  let font: { size: number; weight: number; align: string; color: string; wrap: boolean };
  if (el && geom) {
    box = geom.rect;
    font = sticky
      ? {
          size: STICKY_FONT_SIZE,
          weight: 400,
          align: "left",
          color: "hsl(var(--foreground))",
          wrap: true,
        }
      : {
          size: fontSizePx(el.fontSize),
          weight: weightValue(el.weight),
          align: alignValue(el.align),
          color: inkCss(el.stroke),
          wrap: !el.autoSize,
        };
  } else {
    const size = fontSizePx(style.fontSize);
    const m = measureText("", style.fontSize, style.weight);
    box = { x: draft!.at.x, y: draft!.at.y - m.h / 2, w: m.w, h: m.h };
    font = {
      size,
      weight: weightValue(style.weight),
      align: alignValue(style.align),
      color: inkCss(style.stroke),
      wrap: false,
    };
  }

  return (
    <textarea
      ref={ref}
      data-canvas-editor
      aria-label={sticky ? "Sticky note text" : "Text"}
      spellCheck
      onInput={onInput}
      onKeyDown={onKeyDown}
      onBlur={finish}
      className="pointer-events-auto absolute left-0 top-0 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
      style={{
        transform: `translate(${box.x}px, ${box.y}px)`,
        width: font.wrap || sticky ? box.w : box.w + font.size,
        height: box.h,
        padding: sticky ? STICKY_PADDING : 0,
        fontFamily: "inherit",
        fontSize: font.size,
        fontWeight: font.weight,
        textAlign: font.align as React.CSSProperties["textAlign"],
        lineHeight: TEXT_LINE_HEIGHT,
        color: font.color,
        caretColor: font.color,
        whiteSpace: font.wrap ? "pre-wrap" : "pre",
        overflowWrap: "break-word",
      }}
    />
  );
}
