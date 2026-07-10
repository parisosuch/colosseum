"use client";

import { useState, type ReactNode } from "react";

import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
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
        canEdit={false}
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
