import { LayoutGrid, List } from "lucide-react";

import { Button } from "@/components/ui/button";

export type View = "grid" | "list";

// Segmented grid/list switch. A single pill slides between the two segments
// (state-indication, not decoration) rather than the highlight hard-cutting
// between two buttons; the inactive icon is muted so the selection also reads
// through colour. Buttons are flush (no gap) so the pill's translateX(100%)
// lands exactly one segment over. Reduced-motion is handled globally in
// globals.css.
export function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <div className="relative flex items-center rounded-md border p-0.5">
      <span
        aria-hidden
        className="absolute bottom-0.5 left-0.5 top-0.5 w-8 rounded-[5px] bg-secondary transition-transform duration-200 ease-[var(--ease-out)]"
        style={{ transform: view === "list" ? "translateX(100%)" : "translateX(0)" }}
      />
      <Button
        variant="ghost"
        size="icon"
        className={`relative z-10 size-8 hover:bg-transparent ${view === "grid" ? "" : "text-muted-foreground"}`}
        aria-label="Grid view"
        aria-pressed={view === "grid"}
        onClick={() => onChange("grid")}
      >
        <LayoutGrid />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={`relative z-10 size-8 hover:bg-transparent ${view === "list" ? "" : "text-muted-foreground"}`}
        aria-label="List view"
        aria-pressed={view === "list"}
        onClick={() => onChange("list")}
      >
        <List />
      </Button>
    </div>
  );
}
