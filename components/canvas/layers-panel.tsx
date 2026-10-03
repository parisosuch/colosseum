"use client";

import { useEffect, useRef, useState } from "react";
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
import { layerRows, moveTo } from "@/lib/canvas/tree";
import type { Column } from "@/lib/colosseum/column";
import { cn } from "@/lib/utils";
import { setLayerProps } from "./actions";
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
  if (el.type === "block" && column) return column.title || column.url || "Block";
  return defaultName(el);
}

type Drop = { id: string; where: "above" | "below" | "inside" };

// The Layers tab: frames, groups and elements in z-order, top first. Selection
// syncs both ways with the canvas. Drag a row to reorder it or move it into a
// frame or group, double-click to rename, and hover for hide and lock. Locked
// elements can be selected here and nowhere else.
export function LayersPanel({
  store,
  columns,
}: {
  store: CanvasStore;
  columns: ReadonlyMap<number, Column | null>;
}) {
  const doc = useCanvas(store, "doc", (s) => s.docState);
  const selection = useCanvas(store, "selection", (s) => s.selection);
  const rows = layerRows(doc.elements);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Bring the canvas's selection into view here.
  useEffect(() => {
    const [first] = selection;
    if (!first) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(first)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  if (rows.length === 0) {
    return <p className="text-caption">Nothing on the canvas yet.</p>;
  }

  const click = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = new Set(selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      store.setSelection(next);
    } else {
      store.setSelection([id]);
    }
  };

  const dropFor = (e: React.DragEvent, el: ElementSnapshot): Drop => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientY - r.top) / r.height;
    const container = el.type === "frame" || el.type === "group";
    if (container && t > 0.25 && t < 0.75) return { id: el.id, where: "inside" };
    return { id: el.id, where: t < 0.5 ? "above" : "below" };
  };

  const onDrop = () => {
    const d = drop;
    const dragged = drag;
    setDrop(null);
    setDrag(null);
    if (!d || !dragged || !store.canEdit) return;
    const ids = selection.has(dragged) ? [...selection] : [dragged];
    if (ids.includes(d.id) || ids.some((id) => isDescendant(d.id, id, doc.elements))) return;
    store.undo.stopCapturing();
    if (d.where === "inside") {
      moveTo(store.doc, ids, d.id, store.origin);
    } else {
      const target = doc.elements.get(d.id);
      if (!target) return;
      const parent = target.parentId && doc.elements.has(target.parentId) ? target.parentId : null;
      moveTo(store.doc, ids, parent, store.origin, { id: d.id, where: d.where });
    }
  };

  return (
    <ul
      ref={listRef}
      role="tree"
      aria-label="Layers"
      aria-multiselectable
      className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1"
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
      }}
    >
      {rows.map(({ el, depth }) => {
        const column = el.columnId != null ? columns.get(el.columnId) : undefined;
        const Icon = iconFor(el, column);
        const name = layerName(el, column);
        const selected = selection.has(el.id);
        const marker = drop?.id === el.id ? drop.where : null;
        return (
          <li
            key={el.id}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={selected}
            data-layer={el.id}
            draggable={store.canEdit && renaming !== el.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", name);
              setDrag(el.id);
            }}
            onDragEnd={() => {
              setDrag(null);
              setDrop(null);
            }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDrop(dropFor(e, el));
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop();
            }}
            className={cn(
              "group relative flex h-7 shrink-0 cursor-default items-center gap-2 rounded-md pr-2 text-sm",
              selected ? "bg-secondary" : "hover:bg-accent",
              el.hidden && "text-muted-foreground",
              marker === "inside" && "ring-1 ring-inset ring-foreground",
            )}
            style={{ paddingLeft: 8 + depth * INDENT }}
            tabIndex={selected || (selection.size === 0 && depth === 0) ? 0 : -1}
            onClick={(e) => click(e, el.id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                store.setSelection([el.id]);
              } else if (e.key === "F2" && store.canEdit) {
                e.preventDefault();
                setRenaming(el.id);
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const sib =
                  e.key === "ArrowDown"
                    ? e.currentTarget.nextElementSibling
                    : e.currentTarget.previousElementSibling;
                (sib as HTMLElement | null)?.focus();
              }
            }}
            onDoubleClick={() => store.canEdit && setRenaming(el.id)}
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
            {renaming === el.id ? (
              <RenameInput
                initial={el.name ?? ""}
                placeholder={name}
                onDone={(value) => {
                  setRenaming(null);
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
            {store.canEdit && renaming !== el.id ? (
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
      })}
    </ul>
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
