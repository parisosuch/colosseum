"use client";

import { memo } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { Markdown } from "./markdown";
import type { Column } from "@/lib/colosseum/column";
import { timeAgo } from "@/lib/utils";
import ScreenShotPreview from "./screenshot-preview";
import { Spinner } from "./ui/spinner";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";

// Column template shared by the table header (rendered by the channel board)
// and every row below, so the two line up. Each row is a full-width grid with
// the same tracks, which is what keeps the cells aligned without a real <table>.
// On narrow screens it collapses to Content + Title; the Author / Added-at cells
// are `hidden sm:block`, so they drop out of the grid to match.
export const LIST_GRID =
  "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 items-center sm:grid-cols-[minmax(0,2.5fr)_minmax(0,2.5fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-4";

type ColumnComponentProps = {
  column: Column;
  // Screenshot data hydrated by the parent (one batched query for the whole
  // channel). `undefined` means "not loaded yet" for a URL column; a resolved
  // value may still have a null image_url when no screenshot exists.
  screenshot?: ColumnScreenshot;
  // "grid" (square card, the default) or "list" (Are.na-style table row).
  view?: "grid" | "list";
  // Author handle shown in the list view's Author column. All blocks in a
  // channel share the owner, so the board passes one value for every row.
  author?: string;
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
  view = "grid",
  author,
  onOpen,
}: ColumnComponentProps) {
  const imageURL = screenshot?.image_url ?? null;
  const urlTitle = screenshot?.title ?? "";
  // cache-busting token for the shared storage object (bumped on refresh)
  const screenshotVersion = screenshot?.captured_at ?? null;
  // A URL column is still loading until the parent resolves its screenshot.
  const loading = column.type === "url" && screenshot === undefined;

  // A channel column links to another channel; the whole card is a link to it,
  // not a modal opener. `linked_channel` is resolved by getChannelColumns.
  const linkedHref =
    column.type === "channel" && column.linked_channel
      ? `/${column.linked_channel.handle}/${column.linked_channel_id}`
      : null;

  const thumbnail =
    column.type === "channel" ? (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="max-w-full font-serif text-lg font-medium">
          {column.linked_channel?.title ?? "Channel"}
        </span>
        {column.linked_channel?.description ? (
          <p className="line-clamp-4 break-words text-sm text-muted-foreground">
            {column.linked_channel.description}
          </p>
        ) : null}
      </div>
    ) : column.type === "text" ? (
      <div className="h-full w-full overflow-hidden p-2">
        <Markdown text={column.text ?? ""} className="text-xs" />
      </div>
    ) : column.type === "image" ? (
      <img
        src={`${column.image}?thumb`}
        alt={column.title ?? "Image column"}
        className="w-full h-full object-cover rounded-lg"
      />
    ) : column.type === "pdf" ? (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
        <FileText className="size-10" />
        <span className="line-clamp-2 max-w-full break-words text-xs">{column.title || "PDF"}</span>
      </div>
    ) : loading ? (
      <div className="w-full h-full flex items-center justify-center">
        <Spinner variant="circle" className="size-6 text-muted-foreground" />
      </div>
    ) : (
      <ScreenShotPreview image_url={imageURL} version={screenshotVersion} url={column.url} />
    );

  if (view === "list") {
    // Content column: the domain/path for a link, the text itself for a text
    // block, the linked channel's name for a channel, the title for an image.
    const content =
      column.type === "url"
        ? (column.url ?? "").replace(/^https?:\/\//, "")
        : column.type === "text"
          ? (column.text ?? "")
          : column.type === "channel"
            ? (column.linked_channel?.title ?? "Channel")
            : column.title || (column.type === "pdf" ? "PDF" : "Image");
    const title = column.title || urlTitle || "";

    const rowClass = `w-full border-b px-2 py-2 text-left hover:bg-muted/50 ${LIST_GRID}`;
    const rowInner = (
      <>
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-10 shrink-0 overflow-hidden rounded-md border">
            {column.type === "channel" ? (
              <div className="grid size-full place-items-center bg-muted text-xs font-medium text-muted-foreground">
                {(column.linked_channel?.title ?? "Ch").slice(0, 2).toUpperCase()}
              </div>
            ) : (
              thumbnail
            )}
          </div>
          <span className="truncate text-sm">{content}</span>
        </div>
        <span className="truncate text-sm">{title}</span>
        <span className="hidden truncate text-sm text-muted-foreground sm:block">{author}</span>
        <span className="hidden truncate text-caption sm:block">
          {timeAgo(new Date(column.created_at))}
        </span>
      </>
    );

    if (column.type === "channel") {
      return linkedHref ? (
        <Link href={linkedHref} className={rowClass}>
          {rowInner}
        </Link>
      ) : (
        <div className={rowClass}>{rowInner}</div>
      );
    }

    return (
      <button
        type="button"
        aria-label="Open column"
        onClick={() => onOpen(column.id)}
        className={rowClass}
      >
        {rowInner}
      </button>
    );
  }

  const gridInner = (
    <div className="group relative w-full">
      <div className="w-full aspect-square border rounded-lg text-left">{thumbnail}</div>
      {column.type === "url" ? (
        // Reserve one caption line even when the URL has no title — otherwise
        // an untitled block is a line shorter than its siblings (and its own
        // hover state, which shows the timestamp) and visibly shifts.
        <p className="group-hover:hidden truncate pt-1 text-caption">{urlTitle || " "}</p>
      ) : (
        <p className="pt-1 text-caption opacity-0 group-hover:hidden select-none">placeholder</p>
      )}
      <p className="hidden group-hover:block pt-1 text-caption">
        {timeAgo(new Date(column.created_at))}
      </p>
    </div>
  );

  // Press feedback on the core "open a block" gesture, matching Button's spring.
  const cardPress =
    "transition-transform duration-150 ease-[var(--ease-out)] motion-safe:active:scale-[0.97]";

  if (column.type === "channel") {
    return linkedHref ? (
      <Link href={linkedHref} className={`cv-card block w-full text-left ${cardPress}`}>
        {gridInner}
      </Link>
    ) : (
      <div className="cv-card w-full text-left">{gridInner}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(column.id)}
      className={`cv-card w-full text-left ${cardPress}`}
    >
      {gridInner}
    </button>
  );
});

export default ColumnComponent;
