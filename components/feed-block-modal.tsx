"use client";

import { useState, type ReactNode } from "react";

import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import BlockModal from "@/components/block-modal";

const noop = () => {};

// Opens a block in the shared BlockModal (read-only) from the Explore feed —
// like clicking a block in the channel grid — instead of navigating to its
// page. `children` is the server-rendered focal card. Read-only: the viewer
// doesn't own these blocks, so edit/delete/move are hidden and setColumns is
// never called; there's no prev/next since the feed is heterogeneous.
export function FeedBlockModal({
  column,
  handle,
  screenshot,
  aria,
  children,
}: {
  column: Column;
  handle: string;
  screenshot?: ColumnScreenshot;
  aria: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={aria}
        onClick={() => setOpen(true)}
        className="group block w-full text-left"
      >
        {children}
      </button>
      <BlockModal
        column={column}
        open={open}
        onOpenChange={setOpen}
        isOwner={false}
        handle={handle}
        // Read-only in the feed (like edit/delete/move); the comment thread
        // shows but isn't writable here. ponytail: thread the viewer id through
        // ExploreView if feed-side commenting is ever wanted.
        viewerId={null}
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
