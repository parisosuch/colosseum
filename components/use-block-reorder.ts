"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  anchorBefore,
  cardsPerRow,
  dropSlotAt,
  keyboardMove,
  moveToIndex,
  moveToSlot,
  type CardBox,
  type ReorderAxis,
} from "@/lib/block-reorder";

// Dragging and keying a block card into a new slot on the channel board. The
// arithmetic is in lib/block-reorder.ts; what lives here is the event wiring,
// which is the part that has to coexist with everything else already bound to
// the board.
//
// It is built on pointer events, not on HTML5 drag-and-drop, and that is the
// load-bearing decision rather than a style preference. The board is already a
// full-page drop target for files: dragenter/dragover/dragleave/drop are bound
// to its container with a depth counter, and a `draggable` card would fire that
// same family of events on the way past every element it crossed. Pointer
// events are a disjoint family — a pointerdown never produces a dragenter, and
// a file dragged in from the desktop never produces a pointermove — so the two
// gestures cannot reach each other's handlers at all. The alternative (marking
// cards `draggable` and filtering the file overlay's handlers on
// `dataTransfer.types`) works only as long as every one of those handlers keeps
// its guard, and it is one forgotten guard away from a card drag putting a
// "Drop to add blocks" sheet over the channel.
//
// It is also why there is no drag library here. dnd-kit would bring its own
// pointer sensors and the same disjointness, but the board needs one gesture on
// one grid, and the parts a library earns its weight on — nested droppables,
// virtualised lists, cross-container transfer — are none of them here.

// How far the pointer travels before a press becomes a drag. Below this a
// press-and-release on the handle is treated as a click, so a mis-aimed tap
// doesn't shuffle the board by a pixel of hand tremor.
const DRAG_THRESHOLD_PX = 5;

// How close to the viewport edge the pointer has to get before the page scrolls
// under the drag, and how fast it goes. Without this a card cannot be dragged
// further than one screen, which in a 400-block channel is most of the moves
// anyone would want to make.
const EDGE_SCROLL_ZONE_PX = 72;
const EDGE_SCROLL_MAX_PX_PER_FRAME = 18;

type Item = { id: number };

type UseBlockReorderOptions<T extends Item> = {
  // False in every mode where a drag would be meaningless or ambiguous — a
  // non-owner, a computed sort, a filtered board. The handles aren't rendered
  // and no listener does anything.
  enabled: boolean;
  // The element holding the cards. Their boxes are read from it by
  // `data-column-id`, so no per-card ref plumbing is needed.
  containerRef: React.RefObject<HTMLElement | null>;
  items: T[];
  setItems: (next: T[]) => void;
  // Persist "put `id` directly after `afterId`" (null meaning first). Rejecting
  // is expected — a stale board, a block someone else deleted — and reverts.
  commit: (id: number, afterId: number | null) => Promise<void>;
  // Which way consecutive cards run: the grid wraps left to right, the list
  // runs top to bottom.
  axis: ReorderAxis;
  // Names a block for the live region. Falls back to its position.
  label: (item: T) => string;
};

export type BlockReorder = {
  // The block being dragged or held lifted, so its card can dim and say so.
  activeId: number | null;
  // Whether the active block is held by the keyboard rather than the pointer.
  // A lifted card keeps a visible outline; a dragged one follows the cursor.
  lifted: boolean;
  // What to put in the board's live region. Empty when nothing is happening.
  message: string;
  onHandlePointerDown: (id: number, event: React.PointerEvent<HTMLElement>) => void;
  onHandleKeyDown: (id: number, event: React.KeyboardEvent<HTMLElement>) => void;
  onHandleBlur: () => void;
};

export function useBlockReorder<T extends Item>({
  enabled,
  containerRef,
  items,
  setItems,
  commit,
  axis,
  label,
}: UseBlockReorderOptions<T>): BlockReorder {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [lifted, setLifted] = useState(false);
  const [message, setMessage] = useState("");

  // Everything a move needs to read at event time. A ref, not state: a
  // pointermove fires far more often than the board should render, and while a
  // card is following the cursor nothing about the list has changed yet.
  const latest = useRef({ items, setItems, commit, label, axis, enabled });
  latest.current = { items, setItems, commit, label, axis, enabled };

  // The list as it was when the keyboard lift started, so Escape can put it
  // back exactly rather than trying to invert a run of arrow presses.
  const beforeLift = useRef<T[] | null>(null);

  const describe = useCallback((item: T | undefined, index: number, count: number) => {
    const name = item ? latest.current.label(item) : "Block";
    return `${name}, position ${index + 1} of ${count}`;
  }, []);

  // Send a move to the server, putting the list back if it is refused.
  const persist = useCallback(async (next: T[], id: number, previous: T[]) => {
    const index = next.findIndex((item) => item.id === id);
    try {
      await latest.current.commit(id, anchorBefore(next, index));
    } catch {
      latest.current.setItems(previous);
      setMessage("That move could not be saved. The block is back where it was.");
    }
  }, []);

  // ---------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------

  // Live drag state. Also a ref: the card is moved by writing a transform
  // straight onto its element, so a 60fps drag costs no renders at all and the
  // other cards on a 400-block board are never re-rendered mid-gesture.
  const drag = useRef<{
    id: number;
    from: number;
    startX: number;
    startY: number;
    scrollY: number;
    scrollX: number;
    // Card boxes as measured at the start, in viewport coordinates, plus the
    // scroll they were measured at. The DOM doesn't move during a drag — the
    // list is only reordered on drop — so re-measuring every frame would buy
    // nothing but forced layouts.
    boxes: CardBox[];
    element: HTMLElement | null;
    slot: number | null;
    started: boolean;
    pointerX: number;
    pointerY: number;
    scrollFrame: number | null;
  } | null>(null);

  const cardElements = useCallback((): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) return [];
    return [...container.querySelectorAll<HTMLElement>("[data-column-id]")];
  }, [containerRef]);

  // Mark the card the drop would land beside, so the gap the block is going
  // into is visible. Written straight to the DOM for the same reason as the
  // transform above.
  const paintSlot = useCallback(
    (slot: number | null) => {
      const cards = cardElements();
      for (const card of cards) card.removeAttribute("data-drop");
      if (slot === null) return;
      if (slot < cards.length) cards[slot]?.setAttribute("data-drop", "before");
      else cards[cards.length - 1]?.setAttribute("data-drop", "after");
    },
    [cardElements],
  );

  const endDrag = useCallback(() => {
    const state = drag.current;
    drag.current = null;
    if (!state) return state;
    if (state.scrollFrame !== null) cancelAnimationFrame(state.scrollFrame);
    if (state.element) {
      state.element.style.transform = "";
      state.element.style.zIndex = "";
    }
    paintSlot(null);
    setActiveId(null);
    return state;
  }, [paintSlot]);

  // Scroll the page while the pointer sits near an edge. Runs off rAF rather
  // than off pointermove, because a pointer held still at the edge stops
  // producing moves and the scroll has to keep going.
  const edgeScroll = useCallback(() => {
    const state = drag.current;
    if (!state) return;
    const y = state.pointerY;
    const height = window.innerHeight;
    let dy = 0;
    if (y < EDGE_SCROLL_ZONE_PX) {
      dy = -EDGE_SCROLL_MAX_PX_PER_FRAME * ((EDGE_SCROLL_ZONE_PX - y) / EDGE_SCROLL_ZONE_PX);
    } else if (y > height - EDGE_SCROLL_ZONE_PX) {
      dy =
        EDGE_SCROLL_MAX_PX_PER_FRAME * ((y - (height - EDGE_SCROLL_ZONE_PX)) / EDGE_SCROLL_ZONE_PX);
    }
    if (dy !== 0) window.scrollBy(0, dy);
    state.scrollFrame = requestAnimationFrame(edgeScroll);
  }, []);

  const onHandlePointerDown = useCallback(
    (id: number, event: React.PointerEvent<HTMLElement>) => {
      if (!latest.current.enabled || event.button !== 0 || drag.current) return;
      const from = latest.current.items.findIndex((item) => item.id === id);
      if (from < 0) return;

      // Keep the press off the card's own click handler and out of the
      // browser's text selection.
      event.preventDefault();
      event.stopPropagation();

      const cards = cardElements();
      const element = cards.find((card) => card.dataset.columnId === String(id)) ?? null;
      drag.current = {
        id,
        from,
        startX: event.clientX,
        startY: event.clientY,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        boxes: cards.map((card) => card.getBoundingClientRect()),
        element,
        slot: null,
        started: false,
        pointerX: event.clientX,
        pointerY: event.clientY,
        scrollFrame: null,
      };
      // Capture on the handle, so a fast drag that outruns the pointer still
      // delivers its moves and its release here.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [cardElements],
  );

  // Bound to the window rather than to the handle: with pointer capture the
  // events arrive at the handle anyway, but capture can be lost (a context
  // menu, the element unmounting under a re-render) and a drag that loses its
  // pointerup would otherwise leave the board stuck holding a card.
  useEffect(() => {
    if (!enabled) return;

    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      state.pointerX = event.clientX;
      state.pointerY = event.clientY;

      if (!state.started) {
        const travelled = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
        if (travelled < DRAG_THRESHOLD_PX) return;
        state.started = true;
        setActiveId(state.id);
        setLifted(false);
        state.scrollFrame = requestAnimationFrame(edgeScroll);
      }

      // The boxes were measured at one scroll offset; the pointer is reported
      // at the current one. Compare them in the same frame of reference rather
      // than re-measuring every card on every move.
      const scrolledX = window.scrollX - state.scrollX;
      const scrolledY = window.scrollY - state.scrollY;
      if (state.element) {
        state.element.style.transform = `translate(${event.clientX - state.startX + scrolledX}px, ${event.clientY - state.startY + scrolledY}px)`;
        state.element.style.zIndex = "30";
      }

      const slot = dropSlotAt(
        state.boxes,
        event.clientX + scrolledX,
        event.clientY + scrolledY,
        latest.current.axis,
      );
      if (slot !== state.slot) {
        state.slot = slot;
        paintSlot(slot === state.from || slot === state.from + 1 ? null : slot);
      }
    };

    const onUp = () => {
      const state = drag.current;
      if (!state) return;
      const { id, from, slot, started } = state;
      endDrag();
      if (!started || slot === null) return;

      const previous = latest.current.items;
      const next = moveToSlot(previous, from, slot);
      if (next === previous) return;

      const index = next.findIndex((item) => item.id === id);
      latest.current.setItems(next);
      setMessage(`Moved ${describe(next[index], index, next.length)}`);
      void persist(next, id, previous);
    };

    const onCancel = () => {
      endDrag();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      endDrag();
    };
  }, [enabled, edgeScroll, endDrag, paintSlot, describe, persist]);

  // ---------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------

  // Put focus back on a block's grip after the board has re-rendered around it.
  const refocusHandle = useCallback(
    (id: number) => {
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-column-id="${id}"] [data-reorder-handle]`)
        ?.focus();
    },
    [containerRef],
  );

  const onHandleKeyDown = useCallback(
    (id: number, event: React.KeyboardEvent<HTMLElement>) => {
      if (!latest.current.enabled) return;
      const list = latest.current.items;
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) return;

      const holding = beforeLift.current !== null;

      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!holding) {
          beforeLift.current = list;
          setActiveId(id);
          setLifted(true);
          setMessage(
            `Lifted ${describe(list[index], index, list.length)}. Use the arrow keys to move it, space to drop it, escape to cancel.`,
          );
          return;
        }
        const previous = beforeLift.current!;
        beforeLift.current = null;
        setActiveId(null);
        setLifted(false);
        if (list === previous) {
          setMessage(`Dropped ${describe(list[index], index, list.length)}. Nothing moved.`);
          return;
        }
        setMessage(`Dropped ${describe(list[index], index, list.length)}`);
        void persist(list, id, previous);
        return;
      }

      if (event.key === "Escape") {
        if (!holding) return;
        event.preventDefault();
        const previous = beforeLift.current!;
        beforeLift.current = null;
        setActiveId(null);
        setLifted(false);
        latest.current.setItems(previous);
        const back = previous.findIndex((item) => item.id === id);
        setMessage(`Cancelled. ${describe(previous[back], back, previous.length)}`);
        return;
      }

      if (!holding) return;

      // The grid's column count comes from the laid-out cards, not from the
      // breakpoint that produced them: the same board is 2 cards wide on a
      // phone and 6 on a wide monitor, and Down has to mean a row either way.
      const container = containerRef.current;
      const boxes = container
        ? [...container.querySelectorAll<HTMLElement>("[data-column-id]")].map((card) =>
            card.getBoundingClientRect(),
          )
        : [];
      const perRow = latest.current.axis === "vertical" ? 1 : cardsPerRow(boxes);
      const target = keyboardMove(index, event.key, list.length, perRow);
      if (target === null) return;

      event.preventDefault();
      const next = moveToIndex(list, index, target);
      latest.current.setItems(next);
      setMessage(describe(next[target], target, next.length));
      // The move re-renders the board and React moves this card's DOM node to
      // its new slot. Whether a browser keeps focus on an element that has been
      // moved rather than replaced is not something to bet a whole keyboard
      // path on, so put focus back explicitly after the paint. Focusing an
      // element that already has focus does nothing, so this costs nothing when
      // the browser did keep it.
      requestAnimationFrame(() => refocusHandle(id));
    },
    [containerRef, describe, persist, refocusHandle],
  );

  // Leaving the handle mid-lift has to mean something, and cancelling is the
  // safe read: the block goes back, and nothing is written that the person who
  // moved focus never confirmed.
  //
  // Deferred, and checked against where focus actually went, because a blur is
  // not proof of leaving: the DOM move above can produce one on the way to
  // landing focus straight back on the same handle. Only focus that ends up
  // outside the board counts as walking away.
  const onHandleBlur = useCallback(() => {
    if (beforeLift.current === null) return;
    setTimeout(() => {
      const previous = beforeLift.current;
      if (!previous) return;
      const active = document.activeElement;
      if (active && containerRef.current?.contains(active)) return;
      beforeLift.current = null;
      setActiveId(null);
      setLifted(false);
      latest.current.setItems(previous);
      setMessage("Move cancelled.");
    }, 0);
  }, [containerRef]);

  // Leaving manual mode, filtering the board, or losing permission mid-gesture
  // drops whatever is in hand rather than stranding a lifted card.
  useEffect(() => {
    if (enabled) return;
    beforeLift.current = null;
    setActiveId(null);
    setLifted(false);
    setMessage("");
  }, [enabled]);

  return { activeId, lifted, message, onHandlePointerDown, onHandleKeyDown, onHandleBlur };
}
