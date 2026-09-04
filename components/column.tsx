"use client";

import { memo } from "react";
import { FileText, GripVertical } from "lucide-react";
import { RenderedMarkdown } from "./rendered-markdown";
import type { Column } from "@/lib/colosseum/column";
import { useBlockMediaPrefetch } from "@/components/block-prefetch";
import { useNearViewport } from "@/components/near-viewport";
import {
  CARD_MEDIA_RADIUS,
  CARD_TEXT_CLASS,
  CARD_TEXT_SIZE,
  spotifyEmbedRef,
  thumbSrc,
  timeAgo,
  tweetIdFromUrl,
  youtubeIdFromUrl,
} from "@/lib/utils";
import ScreenShotPreview from "./screenshot-preview";
import TweetBlock from "./tweet-block-lazy";
import YouTubeBlock from "./youtube-block";
import SpotifyBlock from "./spotify-block";
import YouTubeChannelBlock from "./youtube-channel-block";
import GitHubBlock from "./github-block";
import InstagramBlock from "./instagram-block";
import VideoPoster from "./video-poster";
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
  // Manual-order controls. Only set when the board is actually reorderable —
  // the channel's owner, the manual sort, no search or type filter narrowing
  // the grid — so an ordinary read renders none of this. The handlers are
  // stable (they come out of useBlockReorder as useCallbacks), which is what
  // keeps this component's memo worth having while manual mode is on.
  reorderable?: boolean;
  // This card is the one being dragged, or the one held by the keyboard.
  reorderActive?: boolean;
  reorderLifted?: boolean;
  onReorderPointerDown?: (id: number, event: React.PointerEvent<HTMLElement>) => void;
  onReorderKeyDown?: (id: number, event: React.KeyboardEvent<HTMLElement>) => void;
  onReorderBlur?: () => void;
};

// The id of the board's visually-hidden instructions, referenced by every drag
// handle so a screen reader hears how the move works when the handle is focused
// rather than only after the block has been lifted.
export const REORDER_HELP_ID = "block-reorder-help";

// The bar drawn down the edge of the card a drop would land beside. Painted off
// a `data-drop` attribute the reorder hook writes straight to the card element,
// so following the pointer costs no renders; the card carries `group`, which is
// what lets a child react to an attribute on its parent.
function DropIndicator({ axis }: { axis: "grid" | "list" }) {
  const shared =
    "pointer-events-none absolute z-10 rounded-full bg-primary opacity-0 transition-opacity";
  if (axis === "list") {
    return (
      <>
        <span
          aria-hidden
          className={`${shared} inset-x-0 -top-px h-0.5 group-data-[drop=before]:opacity-100`}
        />
        <span
          aria-hidden
          className={`${shared} inset-x-0 -bottom-px h-0.5 group-data-[drop=after]:opacity-100`}
        />
      </>
    );
  }
  return (
    <>
      <span
        aria-hidden
        className={`${shared} inset-y-0 -left-2 w-1 group-data-[drop=before]:opacity-100`}
      />
      <span
        aria-hidden
        className={`${shared} inset-y-0 -right-2 w-1 group-data-[drop=after]:opacity-100`}
      />
    </>
  );
}

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
  reorderable = false,
  reorderActive = false,
  reorderLifted = false,
  onReorderPointerDown,
  onReorderKeyDown,
  onReorderBlur,
}: ColumnComponentProps) {
  // Hovering the card starts fetching what the modal will show, so the click
  // opens onto a decoded image instead of one painting in as it arrives. An
  // embed block opens its connections here instead — the iframe can't be
  // fetched ahead.
  const prefetch = useBlockMediaPrefetch(column, screenshot);
  // A channel read ten pages deep keeps every card it ever loaded mounted, and
  // the expensive part of a card is its media: a decoded thumbnail, or for a
  // tweet a whole react-tweet embed. Cards far from the viewport keep their
  // frame and caption and drop the media, so what a channel holds stays
  // proportional to what is on screen instead of to how far someone has read.
  //
  // The board's `columns` array is untouched, so the modal's index — and the
  // neighbours warmed off that index — mean exactly what they did before. The
  // warmth survives a card being parked too: the prefetch's requested and
  // preconnected sets, the comment cache, and react-tweet's SWR cache are all
  // module-level, so nothing fetched for a card is thrown away with its media.
  const { ref: cardRef, near } = useNearViewport();
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
      <div className={CARD_TEXT_CLASS}>
        <RenderedMarkdown html={column.html ?? ""} className={CARD_TEXT_SIZE} />
      </div>
    ) : column.type === "image" ? (
      <img
        src={thumbSrc(column.image) ?? undefined}
        alt={column.title ?? "Image column"}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={`w-full h-full object-cover ${CARD_MEDIA_RADIUS}`}
      />
    ) : column.type === "pdf" ? (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
        <FileText className="size-10" />
        <span className={`line-clamp-2 max-w-full break-words ${CARD_TEXT_SIZE}`}>
          {column.title || "PDF"}
        </span>
      </div>
    ) : column.type === "video" ? (
      <VideoPoster image={column.image} alt={column.title ?? "Video column"} priority={priority} />
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
    ) : column.type === "github" ? (
      <GitHubBlock
        url={column.url ?? ""}
        title={column.title ?? "GitHub"}
        image={column.image}
        compact
      />
    ) : column.type === "instagram" ? (
      <InstagramBlock
        url={column.url ?? ""}
        title={column.title ?? "Instagram"}
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
        <GradientSpin />
      </div>
    ) : (
      <ScreenShotPreview
        image_url={imageURL}
        version={screenshotVersion}
        url={column.url}
        priority={priority}
      />
    );

  // What the card actually renders in its frame. Parking costs no layout: the
  // frame is sized in CSS either way (a square card in the grid, a 40px thumb in
  // the list). Scrolling back re-mounts it — public media is served `immutable`,
  // so the bytes come from the browser cache rather than the network, and a
  // tweet repaints from the SWR entry its first mount filled.
  const media = near ? thumbnail : null;

  // `reorderLifted` is a board-wide fact — something is being held by the
  // keyboard — so it only says anything about this card when this is the card.
  const heldHere = reorderActive && reorderLifted;

  // The grip that lifts the card, for both gestures: press it and drag, or
  // focus it and press space. One control for both is what keeps the keyboard
  // path discoverable — a move only the keyboard can reach is a move nobody
  // finds. Visible whenever the board is reorderable rather than on hover,
  // since a hover-only affordance doesn't exist on a touchscreen.
  const handle = reorderable ? (
    <button
      type="button"
      aria-label={`Move ${column.title || urlTitle || "this block"}`}
      aria-describedby={REORDER_HELP_ID}
      aria-pressed={heldHere}
      // How the reorder hook finds this grip again after a keyboard move has
      // re-rendered the board out from under it.
      data-reorder-handle=""
      onPointerDown={(e) => onReorderPointerDown?.(column.id, e)}
      onKeyDown={(e) => {
        // The card around this is a role=button that opens the block on Enter
        // and Space — the same two keys that lift and drop.
        e.stopPropagation();
        onReorderKeyDown?.(column.id, e);
      }}
      onBlur={onReorderBlur}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      // touch-none, or a drag on a phone scrolls the page instead of moving
      // the card. Confined to the grip so the rest of the card still scrolls.
      className={`z-20 grid size-9 shrink-0 touch-none place-items-center rounded-md border bg-background/90 text-muted-foreground shadow-sm ${
        heldHere ? "ring-2 ring-ring" : ""
      } cursor-grab active:cursor-grabbing`}
    >
      <GripVertical className="size-4" />
    </button>
  ) : null;

  // A card being dragged follows the pointer and its old slot reads as empty;
  // one held by the keyboard stays put and is outlined instead, because there
  // is no pointer to say where it currently is.
  const activeClass = !reorderActive ? "" : heldHere ? "ring-2 ring-ring rounded-lg" : "opacity-60";

  // A real <button> can't contain the grip (or a tweet embed's own buttons)
  // without nesting interactive elements, so those cases become a role=button
  // div. Keyed on the card element itself so a keypress inside the grip isn't
  // read as "open this block".
  const asDiv = column.type === "tweet" || reorderable;
  const openOnKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(column.id);
    }
  };

  if (view === "list") {
    // Content column: the domain/path for a link, the text itself for a text
    // block, the linked channel's name for a channel, the title for an image.
    const content =
      column.type === "url" ||
      column.type === "tweet" ||
      column.type === "youtube" ||
      column.type === "youtube_channel" ||
      column.type === "github" ||
      column.type === "instagram" ||
      column.type === "spotify"
        ? (column.url ?? "").replace(/^https?:\/\//, "")
        : column.type === "text"
          ? (column.text ?? "")
          : column.type === "channel"
            ? (column.linked_channel?.title ?? "Channel")
            : column.title ||
              (column.type === "pdf" ? "PDF" : column.type === "video" ? "Video" : "Image");
    const title = column.title || urlTitle || "";

    const rowClass = `group relative w-full border-b px-2 py-2 text-left hover:bg-muted/50 ${LIST_GRID} ${activeClass}`;
    const rowInner = (
      <>
        {reorderable ? <DropIndicator axis="list" /> : null}
        <div className="flex min-w-0 items-center gap-2">
          {handle}
          <div className="size-10 shrink-0 overflow-hidden rounded-md border">
            {column.type === "channel" ? (
              <div className="grid size-full place-items-center bg-muted text-xs font-medium text-muted-foreground">
                {(column.linked_channel?.title ?? "Ch").slice(0, 2).toUpperCase()}
              </div>
            ) : (
              media
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

    if (asDiv) {
      return (
        <div
          ref={cardRef}
          role="button"
          tabIndex={0}
          aria-label="Open column"
          data-column-id={column.id}
          onClick={() => onOpen(column.id)}
          onKeyDown={openOnKey}
          {...prefetch}
          className={rowClass}
        >
          {rowInner}
        </div>
      );
    }

    return (
      <button
        ref={cardRef}
        type="button"
        aria-label="Open column"
        data-column-id={column.id}
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
  // block isn't a line shorter than its siblings and doesn't visibly shift. A
  // plain " " collapses to zero height, so untitled blocks (e.g. images) would
  // stand a line short against titled ones.
  const gridTitle = column.title || urlTitle || " ";

  // Title and timestamp both stay on the card. They used to share one line, the
  // timestamp replacing the title on hover — so the one card whose title you
  // were reading was the one card not showing it. Two lines cost a row of
  // height once, and nothing moves under the pointer.
  const gridInner = (
    <div className="relative w-full">
      {reorderable ? <DropIndicator axis="grid" /> : null}
      <div className={`w-full aspect-square border text-left ${CARD_MEDIA_RADIUS}`}>{media}</div>
      {handle ? <div className="absolute left-1 top-1">{handle}</div> : null}
      <p className="truncate pt-1 text-xs" title={column.title || urlTitle || undefined}>
        {gridTitle}
      </p>
      <p className="truncate text-caption">{timeAgo(new Date(column.created_at))}</p>
    </div>
  );

  // Press feedback on the core "open a block" gesture, matching Button's spring.
  // Suppressed while the card is being dragged: the press spring and the drag's
  // own transform are the same property, and the last one written wins.
  const cardPress = reorderActive
    ? ""
    : "transition-transform duration-150 ease-[var(--ease-out)] motion-safe:active:scale-[0.97]";

  if (asDiv) {
    return (
      <div
        ref={cardRef}
        role="button"
        tabIndex={0}
        data-column-id={column.id}
        onClick={() => onOpen(column.id)}
        onKeyDown={openOnKey}
        {...prefetch}
        className={`cv-card group w-full text-left ${
          column.type === "tweet" ? "aspect-square overflow-hidden" : ""
        } ${cardPress} ${activeClass}`}
      >
        {gridInner}
      </div>
    );
  }

  return (
    <button
      ref={cardRef}
      type="button"
      data-column-id={column.id}
      onClick={() => onOpen(column.id)}
      {...prefetch}
      className={`cv-card group w-full text-left ${cardPress} ${activeClass}`}
    >
      {gridInner}
    </button>
  );
});

export default ColumnComponent;
