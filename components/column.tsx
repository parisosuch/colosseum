"use client";

import { memo } from "react";
import { Column } from "@/lib/colosseum/column";
import { timeAgo } from "@/lib/utils";
import ScreenShotPreview from "./screenshot-preview";
import { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";

type ColumnComponentProps = {
  column: Column;
  // Screenshot data hydrated by the parent (one batched query for the whole
  // channel). `undefined` means "not loaded yet" for a URL column; a resolved
  // value may still have a null image_url when no screenshot exists.
  screenshot?: ColumnScreenshot;
  // Open this block in the shared channel modal. Takes the id so the parent can
  // pass one stable handler (keeps the memo'd cards from re-rendering when the
  // open block — and only the open block — changes).
  onOpen: (id: number) => void;
};

// The clickable block card in the channel grid. The modal itself is a single
// shared instance owned by the channel board (see block-modal.tsx), so the card
// only reports that it was opened.
const ColumnComponent = memo(function ColumnComponent({
  column,
  screenshot,
  onOpen,
}: ColumnComponentProps) {
  const imageURL = screenshot?.image_url ?? null;
  const urlTitle = screenshot?.title ?? "";
  // cache-busting token for the shared storage object (bumped on refresh)
  const screenshotVersion = screenshot?.captured_at ?? null;
  // A URL column is still loading until the parent resolves its screenshot.
  const loading = column.type === "url" && screenshot === undefined;

  return (
    <button type="button" onClick={() => onOpen(column.id)} className="cv-card w-full text-left">
      <div className="group relative w-full">
        <div className="w-full aspect-square border rounded-lg text-left">
          {column.type === "text" ? (
            <p className="text-sm line-clamp-[10] p-2">{column.text}</p>
          ) : column.type === "image" ? (
            <img
              src={column.image}
              alt={column.title ?? "Image block"}
              className="w-full h-full object-cover rounded-lg"
            />
          ) : loading ? (
            <div className="w-full h-full flex items-center justify-center animate-pulse">
              Loading...
            </div>
          ) : (
            <ScreenShotPreview image_url={imageURL} version={screenshotVersion} />
          )}
        </div>
        {column.type === "url" ? (
          // Reserve one caption line even when the URL has no title — otherwise
          // an untitled block is a line shorter than its siblings (and its own
          // hover state, which shows the timestamp) and visibly shifts.
          <p className="group-hover:hidden truncate pt-1 text-caption">{urlTitle || " "}</p>
        ) : (
          <p className="pt-1 text-caption opacity-0 group-hover:hidden select-none">placeholder</p>
        )}
        <p className="hidden group-hover:block pt-1 text-caption">
          {timeAgo(new Date(column.created_at))}
        </p>
      </div>
    </button>
  );
});

export default ColumnComponent;
