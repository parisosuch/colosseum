"use client";

import { memo } from "react";
import { FileText, Play } from "lucide-react";
import { RenderedMarkdown } from "./rendered-markdown";
import type { Column } from "@/lib/colosseum/column";
import { useBlockMediaPrefetch } from "@/components/block-prefetch";
import { spotifyEmbedRef, timeAgo, tweetIdFromUrl, youtubeIdFromUrl } from "@/lib/utils";
import ScreenShotPreview from "./screenshot-preview";
import TweetBlock from "./tweet-block-lazy";
import YouTubeBlock from "./youtube-block";
import SpotifyBlock from "./spotify-block";
import YouTubeChannelBlock from "./youtube-channel-block";
import { GradientSpin } from "./gradient-spin";
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
  // Set by the board for the cards that can start above the fold, so their
  // thumbnails load eagerly and the rest wait until scrolled near.
  priority?: boolean;
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
  priority = false,
}: ColumnComponentProps) {
  // Hovering the card starts fetching what the modal will show, so the click
  // opens onto a decoded image instead of one painting in as it arrives.
  const prefetch = useBlockMediaPrefetch(column);
  const imageURL = screenshot?.image_url ?? null;
  const urlTitle = screenshot?.title ?? "";
  // cache-busting token for the shared storage object (bumped on refresh)
  const screenshotVersion = screenshot?.captured_at ?? null;
  // A URL column is still loading until the parent resolves its screenshot.
  const loading = column.type === "url" && screenshot === undefined;

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
        <RenderedMarkdown html={column.html ?? ""} className="text-xs" />
      </div>
    ) : column.type === "image" ? (
      <img
        src={`${column.image}?thumb`}
        alt={column.title ?? "Image column"}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="w-full h-full object-cover rounded-lg"
      />
    ) : column.type === "pdf" ? (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
        <FileText className="size-10" />
        <span className="line-clamp-2 max-w-full break-words text-xs">{column.title || "PDF"}</span>
      </div>
    ) : column.type === "video" ? (
      <div className="relative h-full w-full">
        <video
          src={column.image}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full rounded-lg object-cover"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/50 p-2 text-white">
            <Play className="size-4 fill-current" />
          </span>
        </div>
      </div>
    ) : column.type === "tweet" ? (
      <TweetBlock id={tweetIdFromUrl(column.url ?? "") ?? ""} compact />
    ) : column.type === "youtube" ? (
      <YouTubeBlock id={youtubeIdFromUrl(column.url ?? "") ?? ""} compact />
    ) : column.type === "youtube_channel" ? (
      <YouTubeChannelBlock
        url={column.url ?? ""}
        title={column.title ?? "YouTube channel"}
        image={column.image}
        compact
      />
    ) : column.type === "spotify" ? (
      (() => {
        const ref = spotifyEmbedRef(column.url ?? "");
        return (
          <SpotifyBlock type={ref?.type ?? ""} id={ref?.id ?? ""} image={column.image} compact />
        );
      })()
    ) : loading ? (
      <div className="w-full h-full flex items-center justify-center">
        <GradientSpin cellSize={4} />
      </div>
    ) : (
      <ScreenShotPreview
        image_url={imageURL}
        version={screenshotVersion}
        url={column.url}
        priority={priority}
      />
    );

  if (view === "list") {
    // Content column: the domain/path for a link, the text itself for a text
    // block, the linked channel's name for a channel, the title for an image.
    const content =
      column.type === "url" ||
      column.type === "tweet" ||
      column.type === "youtube" ||
      column.type === "youtube_channel" ||
      column.type === "spotify"
        ? (column.url ?? "").replace(/^https?:\/\//, "")
        : column.type === "text"
          ? (column.text ?? "")
          : column.type === "channel"
            ? (column.linked_channel?.title ?? "Channel")
            : column.title ||
              (column.type === "pdf" ? "PDF" : column.type === "video" ? "Video" : "Image");
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

    return (
      <button
        type="button"
        aria-label="Open column"
        onClick={() => onOpen(column.id)}
        {...prefetch}
        className={rowClass}
      >
        {rowInner}
      </button>
    );
  }

  // The block's title under the card, for every type (falls back to the URL
  // screenshot's title). A non-breaking space is reserved when untitled so the
  // block isn't a line shorter than its siblings (or its own hover state, which
  // swaps in the timestamp) and doesn't visibly shift. A plain " " collapses to
  // zero height, so untitled blocks (e.g. images) would jump when hover reveals
  // the timestamp.
  const gridTitle = column.title || urlTitle || " ";

  const gridInner = (
    <div className="group relative w-full">
      <div className="w-full aspect-square border rounded-lg text-left">{thumbnail}</div>
      <p className="group-hover:hidden truncate pt-1 text-caption">{gridTitle}</p>
      <p className="hidden group-hover:block truncate pt-1 text-caption">
        {timeAgo(new Date(column.created_at))}
      </p>
    </div>
  );

  // Press feedback on the core "open a block" gesture, matching Button's spring.
  const cardPress =
    "transition-transform duration-150 ease-[var(--ease-out)] motion-safe:active:scale-[0.97]";

  // Tweet embeds render their own <button> (copy link), so the card can't be a
  // real <button> without nesting them (invalid HTML). Use a role=button div.
  if (column.type === "tweet") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(column.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(column.id);
          }
        }}
        {...prefetch}
        className={`cv-card aspect-square w-full overflow-hidden text-left ${cardPress}`}
      >
        {gridInner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(column.id)}
      {...prefetch}
      className={`cv-card w-full text-left ${cardPress}`}
    >
      {gridInner}
    </button>
  );
});

export default ColumnComponent;
