"use client";

import { useSyncExternalStore } from "react";

import { GradientSpin } from "@/components/gradient-spin";
import { CARD_MEDIA_RADIUS } from "@/lib/utils";
import type { CanvasStore } from "./canvas-store";
import { pendingUploads } from "./paste-ingest";
import { useCanvas } from "./use-canvas";

// The most the loader and its label grow in world units, so they stay inside
// the card when zoomed far out.
const MAX_LABEL_SCALE = 2.5;

// Pasted and dropped blocks still uploading: a dashed card where the block
// will land, with the loader and what's happening. The card is world-sized
// like a block's media box; its contents stay a readable size on screen.
export function PastePlaceholders({ store }: { store: CanvasStore }) {
  const uploads = pendingUploads(store);
  const items = useSyncExternalStore(uploads.subscribe, uploads.snapshot, uploads.snapshot);
  const zoom = useCanvas(store, "camera", (s) => s.camera.z);
  if (items.length === 0) return null;
  const scale = Math.min(1 / zoom, MAX_LABEL_SCALE);
  return items.map((p) => (
    <div
      key={p.id}
      data-paste-placeholder=""
      className={`pointer-events-none absolute left-0 top-0 flex items-center justify-center overflow-hidden border border-dashed bg-muted ${CARD_MEDIA_RADIUS}`}
      style={{
        transform: `translate(${p.rect.x}px, ${p.rect.y}px)`,
        width: p.rect.w,
        height: p.rect.h,
      }}
    >
      <div className="flex flex-col items-center gap-1.5" style={{ transform: `scale(${scale})` }}>
        <GradientSpin label={p.label} />
        <span className="text-caption" aria-hidden="true">
          {p.label}
        </span>
      </div>
    </div>
  ));
}
