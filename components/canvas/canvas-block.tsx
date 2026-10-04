"use client";

import { memo } from "react";

import { BlockMedia } from "@/components/column";
import { Skeleton } from "@/components/ui/skeleton";
import { BLOCK_CAPTION_HEIGHT } from "@/lib/canvas/elements";
import type { Rect } from "@/lib/canvas/camera";
import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { CARD_MEDIA_RADIUS, timeAgo } from "@/lib/utils";

// A block on the canvas: the grid card's frame, media and two caption lines,
// sized by its element. It takes no pointer events; the viewport hit-tests in
// world space, so an embed inside a card can't swallow a drag.
export const CanvasBlock = memo(function CanvasBlock({
  rect,
  column,
  screenshot,
}: {
  rect: Rect;
  // Undefined while the block is still loading. Null when it isn't in this
  // channel (deleted elsewhere, or an element naming another channel's block).
  column: Column | null | undefined;
  screenshot?: ColumnScreenshot;
}) {
  if (column === null) return null;
  const mediaHeight = Math.max(0, rect.h - BLOCK_CAPTION_HEIGHT);
  const title = column ? column.title || screenshot?.title || " " : " ";
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 select-none"
      style={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.w,
        height: rect.h,
      }}
    >
      {column ? (
        <div
          className={`w-full overflow-hidden border bg-card ${CARD_MEDIA_RADIUS}`}
          style={{ height: mediaHeight }}
        >
          <BlockMedia column={column} screenshot={screenshot} priority />
        </div>
      ) : (
        <Skeleton className="w-full rounded-lg border" style={{ height: mediaHeight }} />
      )}
      <p className="truncate pt-1 text-xs">{title}</p>
      <p className="truncate text-caption">{column ? timeAgo(new Date(column.created_at)) : " "}</p>
    </div>
  );
});
