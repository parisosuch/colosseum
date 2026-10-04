"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BringToFront,
  Ellipsis,
  Group,
  SendToBack,
  Ungroup,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { defaultName, type ElementSnapshot } from "@/lib/canvas/elements";
import {
  FILLS,
  FONT_SIZES,
  FRAME_FILLS,
  HEADS,
  INKS,
  STICKY_FILLS,
  STROKE_WIDTHS,
  WEIGHTS,
} from "@/lib/canvas/style";
import type { AlignMode } from "@/lib/canvas/transform";
import { cn } from "@/lib/utils";
import {
  alignSelection,
  deleteSelection,
  distributeSelection,
  duplicate,
  groupSelection,
  reorderSelection,
  styleSelection,
  supports,
  ungroupSelection,
} from "./actions";
import type { CanvasStore } from "./canvas-store";
import { FillSwatches, InkSwatches, Section, Segmented } from "./controls";
import { useCanvas } from "./use-canvas";

function PanelButton({
  label,
  shortcut,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-3">
        <span>{label}</span>
        {shortcut ? <span className="font-mono">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

// The value every element shares, or null when they differ.
function common<T>(els: readonly ElementSnapshot[], read: (el: ElementSnapshot) => T): T | null {
  if (els.length === 0) return null;
  const first = read(els[0]);
  return els.every((el) => read(el) === first) ? first : null;
}

const WIDTH_OPTIONS = STROKE_WIDTHS.map((w) => ({ value: w, label: String(w), title: `${w}px` }));
const HEAD_LABELS: Record<string, string> = {
  none: "None",
  arrow: "Arrow",
  triangle: "Triangle",
  circle: "Dot",
  bar: "Bar",
};

const ALIGNS: { mode: AlignMode; label: string; key: string; Icon: typeof AlignStartVertical }[] = [
  { mode: "left", label: "Align left", key: "⌥A", Icon: AlignStartVertical },
  { mode: "hcenter", label: "Align horizontal centres", key: "⌥H", Icon: AlignCenterVertical },
  { mode: "right", label: "Align right", key: "⌥D", Icon: AlignEndVertical },
  { mode: "top", label: "Align top", key: "⌥W", Icon: AlignStartHorizontal },
  { mode: "vcenter", label: "Align vertical centres", key: "⌥V", Icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Align bottom", key: "⌥S", Icon: AlignEndHorizontal },
];

// Properties for the current selection, as a floating card top right. Only
// the sections something selected supports show; colours are canvas tokens,
// so drawings flip with dark mode; align and arrange need two or more.
export function PropertiesPanel({ store }: { store: CanvasStore }) {
  const selection = useCanvas(store, "selection", (s) => s.selection);
  const doc = useCanvas(store, "doc", (s) => s.docState);

  const picked = [...selection]
    .map((id) => doc.elements.get(id))
    .filter((el): el is ElementSnapshot => !!el);
  if (picked.length === 0) return null;

  // Groups are styled through what's in them.
  const leaves: ElementSnapshot[] = [];
  const add = (el: ElementSnapshot) => {
    if (el.type !== "group") leaves.push(el);
    else {
      for (const id of doc.children.get(el.id) ?? []) {
        const k = doc.elements.get(id);
        if (k) add(k);
      }
    }
  };
  picked.forEach(add);

  const having = (field: string) => leaves.filter((el) => supports(el, field));
  const strokes = having("stroke");
  const fills = having("fill");
  const widths = having("width");
  const opacities = having("opacity");
  const texts = leaves.filter((el) => el.type === "text");
  const connectors = having("routing");
  const arrows = having("startHead");

  const single = picked.length === 1 ? picked[0] : null;
  const title = single ? single.name || defaultName(single) : `${picked.length} selected`;
  const multi = picked.length > 1;
  const inFrame =
    !!single && !!single.parentId && doc.elements.get(single.parentId)?.type === "frame";
  const hasGroup = picked.some((el) => el.type === "group");

  const fillOptions = fills.every((el) => el.type === "sticky")
    ? STICKY_FILLS
    : fills.every((el) => el.type === "frame")
      ? FRAME_FILLS
      : FILLS;

  const set = (props: Record<string, unknown>) => styleSelection(store, props);

  return (
    <aside
      aria-label="Properties"
      className="flex max-h-full w-72 flex-col gap-4 overflow-y-auto rounded-lg border bg-background p-4 shadow-md"
    >
      <header className="flex items-center gap-1">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        {hasGroup ? (
          <PanelButton label="Ungroup" shortcut="⇧⌘G" onClick={() => ungroupSelection(store)}>
            <Ungroup />
          </PanelButton>
        ) : multi ? (
          <PanelButton label="Group selection" shortcut="⌘G" onClick={() => groupSelection(store)}>
            <Group />
          </PanelButton>
        ) : null}
        <DropdownMenu>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>More actions</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => groupSelection(store)}>
              Group selection
              <DropdownMenuShortcut>⌘G</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!hasGroup} onSelect={() => ungroupSelection(store)}>
              Ungroup
              <DropdownMenuShortcut>⇧⌘G</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => reorderSelection(store, "front")}>
              Bring to front
              <DropdownMenuShortcut>]</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => reorderSelection(store, "forward")}>
              Bring forward
              <DropdownMenuShortcut>⌘]</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => reorderSelection(store, "backward")}>
              Send backward
              <DropdownMenuShortcut>⌘[</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => reorderSelection(store, "back")}>
              Send to back
              <DropdownMenuShortcut>[</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => duplicate(store)}>
              Duplicate
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive-text focus:text-destructive-text"
              onSelect={() => deleteSelection(store)}
            >
              Delete
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {multi || inFrame ? (
        <Section title="Align">
          <div className="flex">
            {ALIGNS.map(({ mode, label, key, Icon }) => (
              <PanelButton
                key={mode}
                label={label}
                shortcut={key}
                onClick={() => alignSelection(store, mode)}
              >
                <Icon />
              </PanelButton>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Arrange">
        <div className="flex">
          {multi ? (
            <>
              <PanelButton
                label="Distribute horizontally"
                shortcut="⇧⌥H"
                disabled={picked.length < 3}
                onClick={() => distributeSelection(store, "x")}
              >
                <AlignHorizontalDistributeCenter />
              </PanelButton>
              <PanelButton
                label="Distribute vertically"
                shortcut="⇧⌥V"
                disabled={picked.length < 3}
                onClick={() => distributeSelection(store, "y")}
              >
                <AlignVerticalDistributeCenter />
              </PanelButton>
            </>
          ) : null}
          <PanelButton
            label="Bring to front"
            shortcut="]"
            onClick={() => reorderSelection(store, "front")}
          >
            <BringToFront />
          </PanelButton>
          <PanelButton
            label="Send to back"
            shortcut="["
            onClick={() => reorderSelection(store, "back")}
          >
            <SendToBack />
          </PanelButton>
        </div>
      </Section>

      {strokes.length || fills.length || widths.length || opacities.length ? (
        <hr className="border-border" />
      ) : null}

      {strokes.length ? (
        <Section title={texts.length === strokes.length ? "Colour" : "Stroke"}>
          <InkSwatches
            values={INKS}
            value={common(strokes, (el) => el.stroke ?? "foreground")}
            onChange={(stroke) => set({ stroke })}
          />
        </Section>
      ) : null}

      {fills.length ? (
        <Section title="Fill">
          <FillSwatches
            values={fillOptions}
            value={common(fills, (el) => el.fill ?? "none")}
            onChange={(fill) => set({ fill })}
          />
        </Section>
      ) : null}

      {widths.length ? (
        <Section title="Stroke width">
          <Segmented
            label="Stroke width"
            options={WIDTH_OPTIONS}
            value={common(widths, (el) => el.width)}
            onChange={(width) => set({ width })}
            mono
          />
        </Section>
      ) : null}

      {connectors.length ? (
        <Section title="Line">
          <Segmented
            label="Routing"
            options={[
              { value: "straight", label: "Straight" },
              { value: "elbow", label: "Elbow" },
            ]}
            value={common(connectors, (el) => el.routing ?? "straight")}
            onChange={(routing) => set({ routing })}
          />
        </Section>
      ) : null}

      {arrows.length ? (
        <Section title="Arrowheads">
          <div className="flex gap-2">
            <Select
              aria-label="Start"
              value={common(arrows, (el) => el.startHead ?? "none") ?? ""}
              onChange={(e) => set({ startHead: e.target.value })}
            >
              {common(arrows, (el) => el.startHead ?? "none") === null ? (
                <option value="">Mixed</option>
              ) : null}
              {HEADS.map((h) => (
                <option key={h} value={h}>
                  {`Start: ${HEAD_LABELS[h]}`}
                </option>
              ))}
            </Select>
            <Select
              aria-label="End"
              value={common(arrows, (el) => el.endHead ?? "arrow") ?? ""}
              onChange={(e) => set({ endHead: e.target.value })}
            >
              {common(arrows, (el) => el.endHead ?? "arrow") === null ? (
                <option value="">Mixed</option>
              ) : null}
              {HEADS.map((h) => (
                <option key={h} value={h}>
                  {`End: ${HEAD_LABELS[h]}`}
                </option>
              ))}
            </Select>
          </div>
        </Section>
      ) : null}

      {opacities.length ? (
        <Section title="Opacity">
          <OpacityInput
            value={common(opacities, (el) => el.opacity)}
            onChange={(opacity) => set({ opacity })}
          />
        </Section>
      ) : null}

      {texts.length ? (
        <Section title="Text">
          <div className="flex gap-2">
            <Select
              aria-label="Font size"
              value={common(texts, (el) => el.fontSize ?? "16") ?? ""}
              onChange={(e) => set({ fontSize: e.target.value })}
            >
              {common(texts, (el) => el.fontSize ?? "16") === null ? (
                <option value="">Mixed</option>
              ) : null}
              {FONT_SIZES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Weight"
              value={common(texts, (el) => el.weight ?? "regular") ?? ""}
              onChange={(e) => set({ weight: e.target.value })}
            >
              {common(texts, (el) => el.weight ?? "regular") === null ? (
                <option value="">Mixed</option>
              ) : null}
              {Object.keys(WEIGHTS).map((w) => (
                <option key={w} value={w}>
                  {w[0].toUpperCase() + w.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex" role="group" aria-label="Alignment">
            {(
              [
                ["left", "Align text left", AlignLeft],
                ["center", "Align text centre", AlignCenter],
                ["right", "Align text right", AlignRight],
              ] as const
            ).map(([align, label, Icon]) => (
              <PanelButton
                key={align}
                label={label}
                active={common(texts, (el) => el.align ?? "left") === align}
                onClick={() => set({ align })}
              >
                <Icon />
              </PanelButton>
            ))}
          </div>
        </Section>
      ) : null}
    </aside>
  );
}

function OpacityInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  const shown = value === null ? "" : `${Math.round(value * 100)}%`;
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  // Escape blurs the field to cancel, and the blur that follows must not
  // apply what was typed.
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const n = Number.parseFloat(draft.replace("%", ""));
    if (Number.isFinite(n)) onChange(Math.min(100, Math.max(0, n)) / 100);
    else setDraft(shown);
  };
  return (
    <Input
      aria-label="Opacity"
      inputMode="numeric"
      placeholder="Mixed"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(shown);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={cn("font-normal")}
    />
  );
}
