"use client";

import { cn } from "@/lib/utils";
import { fillCss, inkCss } from "@/lib/canvas/style";

// The design's colour swatch: a 16px chip in a 24px target, ringed in the
// foreground when picked.
export function Swatch({
  color,
  label,
  selected,
  onSelect,
}: {
  // CSS colour, or null for "none".
  color: string | null;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onSelect}
      className={cn(
        "focus-ring flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-micro",
        selected ? "border-foreground" : "border-transparent hover:border-border",
      )}
    >
      <span
        aria-hidden
        className={cn("relative size-4 overflow-hidden rounded-full", color ? "" : "border")}
        style={color ? { backgroundColor: color } : undefined}
      >
        {color ? null : (
          <span className="absolute left-1/2 top-[-2px] h-5 w-px -translate-x-1/2 rotate-45 bg-destructive-text" />
        )}
      </span>
    </button>
  );
}

const INK_LABELS: Record<string, string> = {
  foreground: "Ink",
  gray: "Gray",
  red: "Red",
  amber: "Amber",
  green: "Green",
  blue: "Blue",
  violet: "Violet",
};

const FILL_LABELS: Record<string, string> = {
  none: "No fill",
  card: "Card",
  yellow: "Yellow note",
  pink: "Pink note",
  blue: "Blue note",
  green: "Green note",
};

export function InkSwatches({
  values,
  value,
  onChange,
}: {
  values: readonly string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Colour">
      {values.map((v) => (
        <Swatch
          key={v}
          color={inkCss(v)}
          label={INK_LABELS[v] ?? v}
          selected={value === v}
          onSelect={() => onChange(v)}
        />
      ))}
    </div>
  );
}

export function FillSwatches({
  values,
  value,
  onChange,
}: {
  values: readonly string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Fill">
      {values.map((v) => (
        <Swatch
          key={v}
          color={fillCss(v)}
          label={FILL_LABELS[v] ?? v}
          selected={value === v}
          onSelect={() => onChange(v)}
        />
      ))}
    </div>
  );
}

// The design's three-way segmented control (stroke width), on the library
// Segmented recipe: rounded-lg border, p-0.5, the active segment bg-secondary.
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  mono = false,
}: {
  options: readonly { value: T; label: React.ReactNode; title?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  mono?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit rounded-lg border p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "focus-ring flex h-7 min-w-8 items-center justify-center rounded-md px-3 text-sm transition-colors duration-micro",
            mono && "font-mono",
            value === o.value
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
