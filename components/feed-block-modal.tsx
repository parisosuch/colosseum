"use client";

import { useState, type ReactNode } from "react";

import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { useBlockMediaPrefetch } from "@/components/block-prefetch";
import BlockModal from "@/components/block-modal";

const noop = () => {};

// Opens a block in the shared BlockModal from the Explore feed — like clicking
// a block in the channel grid — instead of navigating to its page. `children`
// is the server-rendered focal card. The viewer doesn't own these blocks, so
// edit/delete/move are hidden and setColumns is never called; there's no
// prev/next since the feed is heterogeneous. Signed-in viewers can still
// comment, so their id is threaded through.
export function FeedBlockModal({
  column,
  handle,
  screenshot,
  aria,
  viewerId,
  children,
}: {
  column: Column;
  handle: string;
  screenshot?: ColumnScreenshot;
  aria: string;
  viewerId: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Same as the channel grid: warm the modal's image while the pointer rests
  // on the card (lib/prefetch.ts).
  const prefetch = useBlockMediaPrefetch(column, screenshot);

  return (
    <>
      {/* A tweet card renders its own <button> (copy link), so this trigger
          can't be a real <button> without nesting them (invalid HTML that
          breaks hydration). Use a role=button div, mirroring the channel grid
          (components/column.tsx). */}
      <div
        role="button"
        tabIndex={0}
        aria-label={aria}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        {...prefetch}
        className="group block w-full text-left"
      >
        {children}
      </div>
      <BlockModal
        column={column}
        open={open}
        onOpenChange={setOpen}
        isOwner={false}
        canEdit={false}
        isAdmin={false}
        handle={handle}
        viewerId={viewerId}
        setColumns={noop}
        channels={[]}
        screenshot={screenshot}
        onPrev={noop}
        onNext={noop}
        hasPrev={false}
        hasNext={false}
      />
    </>
  );
}
