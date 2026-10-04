"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Diamond,
  Eye,
  EyeOff,
  FileText,
  Frame,
  Github,
  Group,
  Highlighter,
  Image as ImageIcon,
  Link as LinkIcon,
  Lock,
  LockOpen,
  Minus,
  MoveUpRight,
  PenLine,
  Square,
  StickyNote,
  Type,
  Video,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { defaultName, type ElementSnapshot } from "@/lib/canvas/elements";
import { isDescendant } from "@/lib/canvas/hit";
import { layerRows, moveTo, rowWindow } from "@/lib/canvas/tree";
import type { Column } from "@/lib/colosseum/column";
import { cn } from "@/lib/utils";
import { setLayerProps } from "./actions";
import { LAYER_DRAG_TYPE } from "./paste";
import type { CanvasStore } from "./canvas-store";
import { useCanvas } from "./use-canvas";

const INDENT = 16;

function iconFor(el: ElementSnapshot, column: Column | null | undefined) {
  switch (el.type) {
    case "block":
      switch (column?.type) {
        case "image":
          return ImageIcon;
        case "video":
        case "youtube":
          return Video;
        case "pdf":
        case "text":
          return FileText;
        case "github":
          return Github;
        default:
          return LinkIcon;
      }
    case "text":
      return Type;
    case "sticky":
      return StickyNote;
    case "stroke":
      return el.kind === "highlighter" ? Highlighter : PenLine;
    case "rect":
      return Square;
    case "ellipse":
      return Circle;
    case "diamond":
      return Diamond;
    case "line":
      return Minus;
    case "arrow":
      return MoveUpRight;
    case "frame":
      return Frame;
    case "group":
      return Group;
  }
}

export function layerName(el: ElementSnapshot, column: Column | null | undefined): string {
  if (el.name) return el.name;
  if (el.type === "block" && column) {
    return column.title || column.url || column.text?.trim().slice(0, 60) || "Block";
  }
  return defaultName(el);
}

type Drop = { id: string; where: "above" | "below" | "inside" };

// A row is h-7.
const ROW_HEIGHT = 28;

type RowActions = {
  click: (e: React.MouseEvent, id: string) => void;
  dragStart: (id: string) => void;
  dragEnd: () => void;
  dragOver: (e: React.DragEvent, el: ElementSnapshot) => boolean;
  drop: () => void;
  rename: (id: string | null) => void;
  move: (from: string, step: 1 | -1) => void;
};

// The Layers tab: frames, groups and elements in z-order, top first. Selection
// syncs both ways with the canvas. Drag a row to reorder it or move it into a
// frame or group, double-click to rename, and hover for hide and lock. Locked
// elements can be selected here and nowhere else.
//
// Only the rows in view are rendered, and each row re-renders only when its
// own element, selection state or drop marker changes, so a drag on a 5,000
// element board repaints one row here.
export function LayersPanel({
  store,
  columns,
}: {
  store: CanvasStore;
  columns: ReadonlyMap<number, Column | null>;
}) {
  const doc = useCanvas(store, "doc", (s) => s.docState);
  const selection = useCanvas(store, "selection", (s) => s.selection);
  const canEdit = useCanvas(store, "connection", (s) => s.canEdit);
  const rows = useMemo(() => layerRows(doc.children), [doc.children]);
  const empty = rows.length === 0;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const drag = useRef<string | null>(null);
  const dropRef = useRef<Drop | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  // A row to focus once it's rendered (arrow keys can walk past the window).
  const focusNext = useRef<string | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setView({ top: list.scrollTop, height: list.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [empty]);

  // Scroll row `index` into view, the way scrollIntoView({block: "nearest"})
  // would, and render the window around it now rather than on the scroll event.
  const reveal = (index: number) => {
    const list = listRef.current;
    if (!list || index < 0) return;
    const top = index * ROW_HEIGHT;
    let next = list.scrollTop;
    if (top < next) next = top;
    else if (top + ROW_HEIGHT > next + list.clientHeight)
      next = top + ROW_HEIGHT - list.clientHeight;
    if (next !== list.scrollTop) list.scrollTop = next;
    setView({ top: list.scrollTop, height: list.clientHeight });
  };

  // Bring the canvas's selection into view here.
  const [firstSelected] = selection;
  useEffect(() => {
    if (!firstSelected) return;
    reveal(rows.findIndex((r) => r.id === firstSelected));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the selection changes, not on every edit.
  }, [selection]);

  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(id)}"]`);
    if (row) {
      focusNext.current = null;
      row.focus();
    }
  });

  const setDropBoth = (d: Drop | null) => {
    dropRef.current = d;
    setDrop((cur) =>
      cur === d || (cur && d && cur.id === d.id && cur.where === d.where) ? cur : d,
    );
  };

  // The rows' handlers, made once: everything they read is a ref, the store
  // or a state setter, so a row never re-renders for a new handler.
  const rowsRef = useRef(rows);
  useLayoutEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const [actions] = useState<RowActions>(() => ({
    click: (e, id) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        // The store's selection, not this render's: two quick clicks would
        // otherwise both start from the same stale set.
        const next = new Set(store.selection);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        store.setSelection(next);
      } else {
        store.setSelection([id]);
      }
    },
    dragStart: (id) => {
      drag.current = id;
    },
    dragEnd: () => {
      drag.current = null;
      setDropBoth(null);
    },
    dragOver: (e, el) => {
      if (!drag.current) return false;
      setDropBoth(dropFor(e, el));
      return true;
    },
    drop: () => {
      const d = dropRef.current;
      const dragged = drag.current;
      drag.current = null;
      setDropBoth(null);
      if (!d || !dragged || !store.canEdit) return;
      const all = store.docState.elements;
      const ids = store.selection.has(dragged) ? [...store.selection] : [dragged];
      if (ids.includes(d.id) || ids.some((id) => isDescendant(d.id, id, all))) return;
      store.undo.stopCapturing();
      if (d.where === "inside") {
        moveTo(store.doc, ids, d.id, store.origin);
      } else {
        const target = all.get(d.id);
        if (!target) return;
        const parent = target.parentId && all.has(target.parentId) ? target.parentId : null;
        moveTo(store.doc, ids, parent, store.origin, { id: d.id, where: d.where });
      }
    },
    rename: setRenaming,
    move: (from, step) => {
      const list = rowsRef.current;
      const i = list.findIndex((r) => r.id === from) + step;
      if (i < 0 || i >= list.length) return;
      focusNext.current = list[i].id;
      reveal(i);
    },
  }));

  if (rows.length === 0) {
    return <p className="text-caption">Nothing on the canvas yet.</p>;
  }

  const { first, last } = rowWindow(view.top, view.height || 600, rows.length, ROW_HEIGHT);
  return (
    <ul
      ref={listRef}
      role="tree"
      aria-label="Layers"
      aria-multiselectable
      className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1"
      onScroll={(e) =>
        setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })
      }
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropBoth(null);
      }}
    >
      {first > 0 ? (
        <li aria-hidden className="shrink-0" style={{ height: first * ROW_HEIGHT }} />
      ) : null}
      {rows.slice(first, last).map(({ id, depth }) => {
        const el = doc.elements.get(id);
        if (!el) return null;
        return (
          <LayerRow
            key={id}
            el={el}
            depth={depth}
            column={el.columnId != null ? columns.get(el.columnId) : undefined}
            selected={selection.has(id)}
            tabbable={selection.has(id) || (selection.size === 0 && depth === 0)}
            marker={drop?.id === id ? drop.where : null}
            renaming={renaming === id}
            canEdit={canEdit}
            store={store}
            actions={actions}
          />
        );
      })}
      {last < rows.length ? (
        <li
          aria-hidden
          className="shrink-0"
          style={{ height: (rows.length - last) * ROW_HEIGHT }}
        />
      ) : null}
    </ul>
  );
}

function dropFor(e: React.DragEvent, el: ElementSnapshot): Drop {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const t = (e.clientY - r.top) / r.height;
  const container = el.type === "frame" || el.type === "group";
  if (container && t > 0.25 && t < 0.75) return { id: el.id, where: "inside" };
  return { id: el.id, where: t < 0.5 ? "above" : "below" };
}

function LayerRow({
  el,
  depth,
  column,
  selected,
  tabbable,
  marker,
  renaming,
  canEdit,
  store,
  actions,
}: {
  el: ElementSnapshot;
  depth: number;
  column: Column | null | undefined;
  selected: boolean;
  tabbable: boolean;
  marker: Drop["where"] | null;
  renaming: boolean;
  canEdit: boolean;
  store: CanvasStore;
  actions: RowActions;
}) {
  const Icon = iconFor(el, column);
  const name = layerName(el, column);
  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      data-layer={el.id}
      draggable={canEdit && !renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(LAYER_DRAG_TYPE, el.id);
        actions.dragStart(el.id);
      }}
      onDragEnd={() => actions.dragEnd()}
      onDragOver={(e) => {
        if (!actions.dragOver(e, el)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        actions.drop();
      }}
      className={cn(
        "group relative flex h-7 shrink-0 cursor-default items-center gap-2 rounded-md pr-2 text-sm",
        selected ? "bg-secondary" : "hover:bg-accent",
        el.hidden && "text-muted-foreground",
        marker === "inside" && "ring-1 ring-inset ring-foreground",
      )}
      style={{ paddingLeft: 8 + depth * INDENT }}
      tabIndex={tabbable ? 0 : -1}
      onClick={(e) => actions.click(e, el.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          store.setSelection([el.id]);
        } else if (e.key === "F2" && canEdit) {
          e.preventDefault();
          actions.rename(el.id);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          actions.move(el.id, e.key === "ArrowDown" ? 1 : -1);
        }
      }}
      onDoubleClick={() => canEdit && actions.rename(el.id)}
    >
      {marker === "above" || marker === "below" ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-0 h-0.5 bg-foreground",
            marker === "above" ? "-top-px" : "-bottom-px",
          )}
          style={{ left: 8 + depth * INDENT }}
        />
      ) : null}
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {renaming ? (
        <RenameInput
          initial={el.name ?? ""}
          placeholder={name}
          onDone={(value) => {
            actions.rename(null);
            if (value !== null && value !== (el.name ?? "")) {
              setLayerProps(store, el.id, { name: value.trim() || null });
            }
          }}
        />
      ) : (
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            el.hidden && "line-through decoration-muted-foreground/50",
          )}
        >
          {name}
        </span>
      )}
      {canEdit && !renaming ? (
        <span className="flex shrink-0 items-center gap-1">
          <RowToggle
            on={el.hidden}
            label={el.hidden ? `Show ${name}` : `Hide ${name}`}
            onToggle={() => setLayerProps(store, el.id, { hidden: !el.hidden })}
            onIcon={<EyeOff />}
            offIcon={<Eye />}
          />
          <RowToggle
            on={el.locked}
            label={el.locked ? `Unlock ${name}` : `Lock ${name}`}
            onToggle={() => setLayerProps(store, el.id, { locked: !el.locked })}
            onIcon={<Lock />}
            offIcon={<LockOpen />}
          />
        </span>
      ) : null}
    </li>
  );
}

// Hide or lock: shown on hover, and always while it's on.
function RowToggle({
  on,
  label,
  onToggle,
  onIcon,
  offIcon,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "focus-ring flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:opacity-100 [&_svg]:size-4",
        on ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    >
      {on ? onIcon : offIcon}
    </button>
  );
}

function RenameInput({
  initial,
  placeholder,
  onDone,
}: {
  initial: string;
  placeholder: string;
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <Input
      ref={ref}
      aria-label="Layer name"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(null);
      }}
      onClick={(e) => e.stopPropagation()}
      className="h-6 flex-1 px-1.5 py-0 text-sm"
    />
  );
}
