"use client";

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderInput,
  GlobeIcon,
  LinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import ColumnComments from "./column-comments";
import { RenderedMarkdown } from "./rendered-markdown";
import TweetBlock from "./tweet-block-lazy";
import YouTubeBlock from "./youtube-block";
import SpotifyBlock from "./spotify-block";
import YouTubeChannelBlock from "./youtube-channel-block";
import GitHubBlock from "./github-block";
import InstagramBlock from "./instagram-block";
import LinkPreviewEmpty from "./link-preview-empty";
import {
  cn,
  screenshotSrc,
  spotifyEmbedRef,
  THUMB_MAX_WIDTH,
  thumbSrc,
  tweetIdFromUrl,
  youtubeIdFromUrl,
} from "@/lib/utils";
import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import {
  adminDeleteColumnAction,
  copyColumnAction,
  deleteColumnAction,
  moveColumnAction,
  updateColumnDescriptionAction,
  updateColumnTagsAction,
  updateColumnTextAction,
  updateColumnTitleAction,
} from "@/lib/colosseum/actions";
import type { PickableChannel } from "@/components/add-block-drawer";
import AdminDeleteButton from "@/components/admin-delete-button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import TagInput from "@/components/tag-input";

type BlockModalProps = {
  // The block to show, or null when nothing is open. The channel board owns this.
  column: Column | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Channel owner: gates moderation (delete any comment) and the "Move" picker.
  isOwner: boolean;
  // May edit/delete *this* block: the channel owner or the block's own creator.
  canEdit: boolean;
  // Viewer is an admin moderating a public/open channel (false for private).
  // Unlocks deleting a block they don't own.
  isAdmin: boolean;
  handle: string;
  // The signed-in viewer's id, or null when signed out. Drives commenting.
  viewerId: string | null;
  setColumns: Dispatch<SetStateAction<Column[]>>;
  // The viewer's own channels, for the "Move" (owner-only) and "Copy" (any
  // viewer) pickers. Empty when signed out.
  channels: PickableChannel[];
  screenshot?: ColumnScreenshot;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
};

// Renders a live draft in the browser, the one case the server can't cover.
// Loaded on demand so marked and sanitize-html stay out of the page bundle: an
// unedited draft reuses the block's server-rendered HTML (below), so the chunk
// is only fetched once an editor changes something.
const MarkdownPreview = dynamic(() => import("./markdown-preview"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Rendering preview…</p>,
});

// The Move/Copy picker (cmdk) and the delete confirmation (the alert dialog).
// The channel board renders this modal on every channel page, so a static
// import would put both in the bundle for anyone who opens a block — and
// neither is on the way to reading one. Move is owner-only and behind a click,
// Copy needs a signed-in viewer with a channel of their own, Delete is a click
// plus a confirmation.
//
// No `loading` placeholder: nothing of either is meant to be on screen until
// its own dialog opens. The button that opens one warms its chunk on hover
// (see `warm`), so the click usually finds it already there.
const loadChannelPicker = () => import("./block-channel-picker");
const loadDeleteDialog = () => import("./delete-block-dialog");
const BlockChannelPicker = dynamic(loadChannelPicker, { ssr: false });
const DeleteBlockDialog = dynamic(loadDeleteDialog, { ssr: false });

// A dialog whose contents are code-split: nothing renders (so no chunk is
// fetched) until the trigger is used, and once it has been, the dialog stays
// mounted so closing still plays its exit animation.
function useDeferredDialog(load: () => Promise<unknown>) {
  const [used, setUsed] = useState(false);
  const [open, setOpen] = useState(false);
  return {
    mounted: used,
    open,
    setOpen,
    show: () => {
      setUsed(true);
      setOpen(true);
    },
    // Hovering (or focusing) the trigger starts the chunk, the same bet the
    // grid makes on a card's full-size image.
    warm: () => void load(),
  };
}

// The full-size image, with the grid's thumbnail painted behind it until it
// arrives. The card the modal was opened from has already decoded that
// thumbnail, so the placeholder costs no request and paints in the first frame —
// which covers both a cold open of a large image and a run of arrow presses
// fast enough to outpace the neighbour prefetch.
//
// The thumbnail is the element that sizes the box: the full-size image has no
// intrinsic dimensions until it loads, whereas the thumbnail has the source's
// aspect ratio from the start. The full-size image then fills that box, and
// `object-scale-down` reproduces what plain `max-w`/`max-h` did before — natural
// size when it fits, contained when it doesn't — so nothing moves when it lands.
//
// On md the box is the whole panel, so how far the thumbnail may be blown up to
// fill it comes from the thumbnail's own width: the resize never enlarges, so
// one narrower than THUMB_MAX_WIDTH is the source itself and is drawn at that
// size, exactly where the full-size image will land. A downsized one is drawn
// to fill, which is exact for a source larger than the panel — the case this is
// for — and generous for one in between, blurred, for the moment it shows.
function BlockImage({ src, alt }: { src: string | undefined; alt: string }) {
  const thumb = thumbSrc(src);
  const [loaded, setLoaded] = useState(false);
  const [downsized, setDownsized] = useState(true);
  const fullRef = useRef<HTMLImageElement>(null);
  const thumbRef = useRef<HTMLImageElement>(null);

  const measureThumb = () => {
    const width = thumbRef.current?.naturalWidth ?? 0;
    if (width > 0) setDownsized(width >= THUMB_MAX_WIDTH);
  };

  // An image served from cache can finish before React attaches its handlers,
  // which would leave the blurred thumbnail up for good. `complete` catches it.
  useEffect(() => {
    if (fullRef.current?.complete) setLoaded(true);
    if (thumbRef.current?.complete) measureThumb();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a mount-only read of the two <img> elements; measureThumb is stable enough for it.
  }, []);

  // Nothing to paint behind: fall back to the bare image.
  if (!thumb) {
    return (
      <img
        src={src}
        alt={alt}
        className="max-h-[70vh] md:max-h-full max-w-full object-contain rounded-md"
      />
    );
  }

  return (
    <div className="relative flex max-h-[70vh] max-w-full items-center justify-center overflow-hidden rounded-md md:h-full md:w-full md:max-h-full">
      <img
        ref={thumbRef}
        src={thumb}
        alt=""
        aria-hidden
        onLoad={measureThumb}
        className={cn(
          "max-h-[70vh] max-w-full blur-[6px] md:absolute md:inset-0 md:h-full md:w-full md:max-h-none",
          downsized ? "object-contain" : "object-scale-down",
          // Kept in flow (not `hidden`) so the box it sizes on mobile survives.
          loaded && "opacity-0",
        )}
      />
      <img
        ref={fullRef}
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={cn(
          "absolute inset-0 h-full w-full object-scale-down transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

// A text block is markdown. Viewers see it rendered; editors get GitHub-style
// Write/Preview tabs over a monospace textarea (raw syntax stays visible while
// writing), Preview rendering the current draft.
//
// `savedHtml` is the block's markdown as the server rendered and sanitized it.
// It covers every read-only path — viewers, and editors who haven't touched the
// draft — so the browser only needs a renderer for genuinely unsaved text.
function MarkdownEditor({
  text,
  savedText,
  savedHtml,
  setText,
  canEdit,
  textRef,
}: {
  text: string;
  savedText: string;
  savedHtml: string;
  setText: (v: string) => void;
  canEdit: boolean;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  // Default to Preview (rendered markdown) — editors switch to Write to edit.
  const [mode, setMode] = useState<"write" | "preview">("preview");

  if (!canEdit) {
    return (
      <div className="w-full max-h-full overflow-y-auto">
        <RenderedMarkdown html={savedHtml} />
      </div>
    );
  }

  return (
    <div className="flex w-full min-h-0 flex-col gap-2 self-stretch">
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          size="sm"
          variant={mode === "write" ? "secondary" : "ghost"}
          onClick={() => setMode("write")}
        >
          Write
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "preview" ? "secondary" : "ghost"}
          onClick={() => setMode("preview")}
        >
          Preview
        </Button>
      </div>
      {mode === "write" ? (
        <Textarea
          ref={textRef}
          value={text}
          // Fill the panel height (override the base field-sizing-content, which
          // would otherwise shrink to the text) so it matches the sidebar.
          className="min-h-40 flex-1 [field-sizing:fixed] font-mono"
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <div className="min-h-40 w-full flex-1 overflow-y-auto rounded-md border p-3">
          {!text.trim() ? (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          ) : text === savedText ? (
            <RenderedMarkdown html={savedHtml} />
          ) : (
            <MarkdownPreview text={text} />
          )}
        </div>
      )}
    </div>
  );
}

// One shared modal for the whole channel. Stepping between blocks only swaps the
// body (keyed by block id) — the Dialog stays mounted and open, so navigation
// never replays the open/close animation. A sticky last-column keeps the body
// rendered through the close animation after the parent clears `column`.
export default function BlockModal({
  column,
  open,
  onOpenChange,
  isOwner,
  canEdit,
  isAdmin,
  handle,
  viewerId,
  setColumns,
  channels,
  screenshot,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: BlockModalProps) {
  const lastColumn = useRef<Column | null>(column);
  if (column) lastColumn.current = column;
  const displayColumn = column ?? lastColumn.current;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed frame on every breakpoint (not h-auto), and flex-col so the body
          fills it — stepping between blocks never resizes the modal or shifts
          the nav arrows. */}
      <DialogContent
        className="flex flex-col w-[97vw] h-[95vh] md:h-[97vh] !max-w-none p-4 outline-none"
        onKeyDown={(e) => {
          // Arrow keys step between blocks — but not while editing a field,
          // where the arrows should move the cursor.
          const tag = (e.target as HTMLElement).tagName;
          if (tag === "INPUT" || tag === "TEXTAREA") return;
          if (e.key === "ArrowLeft" && hasPrev) {
            e.preventDefault();
            onPrev();
          } else if (e.key === "ArrowRight" && hasNext) {
            e.preventDefault();
            onNext();
          }
        }}
      >
        {displayColumn ? (
          <BlockModalBody
            key={displayColumn.id}
            column={displayColumn}
            isOwner={isOwner}
            canEdit={canEdit}
            isAdmin={isAdmin}
            handle={handle}
            viewerId={viewerId}
            setColumns={setColumns}
            channels={channels}
            screenshot={screenshot}
            onPrev={onPrev}
            onNext={onNext}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// The editable body for a single block. Keyed by block id in the parent, so its
// draft state resets cleanly when navigation swaps in a different block.
function BlockModalBody({
  column,
  isOwner,
  canEdit,
  isAdmin,
  handle,
  viewerId,
  setColumns,
  channels,
  screenshot,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  column: Column;
  isOwner: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  handle: string;
  viewerId: string | null;
  setColumns: Dispatch<SetStateAction<Column[]>>;
  channels: PickableChannel[];
  screenshot?: ColumnScreenshot;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const [title, setTitle] = useState(column.title ?? "");
  const [description, setDescription] = useState(column.description ?? "");
  const [text, setText] = useState(column.text ?? "");
  // A stored screenshot can 404; fall back to the placeholder. The body is keyed
  // by block id in the parent, so this resets when navigating between blocks.
  const [imageErrored, setImageErrored] = useState(false);
  // Swaps the copy button for a tick for a moment after a successful copy —
  // the clipboard gives no other feedback that it worked.
  const [urlCopied, setUrlCopied] = useState(false);

  const urlTitle = screenshot?.title ?? "";
  const imageSrc = screenshotSrc(screenshot?.image_url, screenshot?.captured_at);

  const isDirty =
    title !== (column.title ?? "") ||
    description !== (column.description ?? "") ||
    text !== (column.text ?? "");

  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Horizontal-swipe navigation (mobile). Fire only when the gesture is clearly
  // horizontal and past a threshold, so vertical scrolling still works.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // Copy the block's own URL (the site it points at, not its permalink).
  const handleCopyUrl = async () => {
    if (!column.url) return;
    try {
      await navigator.clipboard.writeText(column.url);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 1500);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't copy that link.");
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0 && hasNext) onNext();
    else if (dx > 0 && hasPrev) onPrev();
  };

  // The field savers throw on failure rather than logging and returning: their
  // callers are the only place that knows whether to report one failed write or
  // a whole failed Save, and a swallowed error here reads to the user as a
  // successful edit. Nothing after the await runs on failure, so the input keeps
  // focus and the card keeps the old value.
  const handleTitleChange = async () => {
    if ((column.title ?? "") === title) return;
    await updateColumnTitleAction(column.id, title);
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, title } : c)));
    titleInputRef.current?.blur();
  };

  const handleDescriptionChange = async () => {
    if ((column.description ?? "") === description) return;
    await updateColumnDescriptionAction(column.id, description);
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, description } : c)));
    descriptionInputRef.current?.blur();
  };

  // Enter in the title or description commits that one field. Success is visible
  // (the input blurs, the card updates), so only the failure needs saying.
  const saveField = async (save: () => Promise<void>) => {
    try {
      await save();
    } catch (e) {
      console.error(e);
      toast.error("Couldn't save. Please try again.");
    }
  };

  const handleTextChange = async () => {
    // The action hands back the saved markdown already rendered and sanitized,
    // so the card and the Preview tab pick up the edit without the browser
    // re-parsing it.
    const html = await updateColumnTextAction(column.id, text);
    textInputRef.current?.blur();
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, text, html } : c)));
  };

  // Tags persist eagerly on each add/remove, so they stay out of the Save flow.
  const handleTagsChange = async (next: string[]) => {
    try {
      await updateColumnTagsAction(column.id, next);
      setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, tags: next } : c)));
    } catch (e) {
      console.error(e);
      toast.error("Couldn't save tags. Please try again.");
    }
  };

  const confirmDelete = useDeferredDialog(loadDeleteDialog);

  const handleDelete = async () => {
    try {
      await deleteColumnAction(column.id);
      // Dropping the block clears the open id in the parent, which closes here.
      setColumns((cols) => cols.filter((c) => c.id !== column.id));
    } catch (e) {
      console.error(e);
      // The confirmation dialog has already closed itself, so the toast is the
      // only thing left to say the block is still there.
      toast.error("Couldn't delete that block. Please try again.");
    }
  };

  // Channels the block can move/copy to: the viewer's own, minus the one it's
  // already in. (On someone else's channel, none is excluded — it isn't yours.)
  const moveTargets = channels.filter((c) => c.id !== column.channel_id);
  const copyTargets = moveTargets;
  const move = useDeferredDialog(loadChannelPicker);
  const [moving, setMoving] = useState(false);

  const handleMove = async (targetChannelId: number) => {
    if (moving) return;
    setMoving(true);
    try {
      await moveColumnAction(column.id, targetChannelId);
      move.setOpen(false);
      // The block no longer belongs to this channel: drop it, which clears the
      // open id in the parent and closes the modal (same path as delete).
      setColumns((cols) => cols.filter((c) => c.id !== column.id));
      toast.success("Moved.");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't move that column. Please try again.");
      setMoving(false);
    }
  };

  const copy = useDeferredDialog(loadChannelPicker);
  const [copying, setCopying] = useState(false);

  // Copy leaves the source in place, so — unlike move — the current board is
  // untouched; the duplicate lands in the target channel.
  const handleCopy = async (targetChannelId: number) => {
    if (copying) return;
    setCopying(true);
    try {
      await copyColumnAction(column.id, targetChannelId);
      copy.setOpen(false);
      toast.success("Copied.");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't copy that column. Please try again.");
    } finally {
      setCopying(false);
    }
  };

  // Saves the dirty fields in order and stops at the first failure, so "Saved."
  // is only ever shown over writes that landed. A failure leaves the block
  // dirty, which keeps the Save button on screen to try again.
  const handleSave = async () => {
    try {
      await handleTitleChange();
      await handleDescriptionChange();
      if (text !== (column.text ?? "")) {
        await handleTextChange();
      }
      toast.success("Saved.");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't save. Please try again.");
    }
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="flex flex-1 min-h-0 flex-col md:flex-row pt-4 px-4 gap-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-full min-h-0 items-center justify-center p-2 md:w-3/4 md:p-6">
        {column.type === "text" ? (
          <MarkdownEditor
            text={text}
            savedText={column.text ?? ""}
            savedHtml={column.html ?? ""}
            setText={setText}
            canEdit={canEdit}
            textRef={textInputRef}
          />
        ) : column.type === "image" ? (
          <BlockImage src={column.image} alt={column.title ?? "Image column"} />
        ) : column.type === "pdf" ? (
          <object
            data={column.image}
            type="application/pdf"
            aria-label={column.title ?? "PDF"}
            className="h-[70vh] w-full rounded-md border md:h-full"
          >
            <a href={column.image} target="_blank" rel="noreferrer" className="underline">
              Open PDF
            </a>
          </object>
        ) : column.type === "video" ? (
          <video
            src={column.image}
            controls
            playsInline
            className="max-h-[70vh] md:max-h-full max-w-full rounded-md"
          >
            {/* User uploads carry no caption file; empty track satisfies a11y. */}
            <track kind="captions" />
          </video>
        ) : column.type === "tweet" ? (
          <div className="max-h-full w-full max-w-xl overflow-y-auto">
            <TweetBlock id={tweetIdFromUrl(column.url ?? "") ?? ""} />
          </div>
        ) : column.type === "youtube" ? (
          <div className="w-full max-w-3xl">
            <YouTubeBlock id={youtubeIdFromUrl(column.url ?? "") ?? ""} />
          </div>
        ) : column.type === "youtube_channel" ? (
          <div className="w-full max-w-xl">
            <YouTubeChannelBlock
              url={column.url ?? ""}
              title={column.title ?? "YouTube channel"}
              description={column.description ?? undefined}
              image={column.image}
            />
          </div>
        ) : column.type === "github" ? (
          <div className="w-full max-w-xl">
            <GitHubBlock
              url={column.url ?? ""}
              title={column.title ?? "GitHub"}
              description={column.description ?? undefined}
              image={column.image}
              language={column.text ?? undefined}
            />
          </div>
        ) : column.type === "instagram" ? (
          <div className="w-full max-w-xl">
            <InstagramBlock
              url={column.url ?? ""}
              title={column.title ?? "Instagram"}
              description={column.description ?? undefined}
              image={column.image}
            />
          </div>
        ) : column.type === "spotify" ? (
          <div className="w-full max-w-2xl">
            <SpotifyBlock
              type={spotifyEmbedRef(column.url ?? "")?.type ?? ""}
              id={spotifyEmbedRef(column.url ?? "")?.id ?? ""}
              image={column.image}
            />
          </div>
        ) : column.type === "channel" ? (
          <Link
            href={`/${column.linked_channel?.handle}/${column.linked_channel_id}`}
            className="flex aspect-square w-full max-w-md flex-col items-center justify-center gap-2 rounded-md border p-6 text-center transition-colors hover:bg-accent"
          >
            <span className="max-w-full text-title">
              {column.linked_channel?.title ?? "Channel"}
            </span>
            {column.linked_channel?.description ? (
              <p className="line-clamp-4 max-w-full break-words text-sm text-muted-foreground">
                {column.linked_channel.description}
              </p>
            ) : null}
            <span className="text-caption">
              {column.linked_channel?.count ?? 0} blocks · open channel →
            </span>
          </Link>
        ) : (
          <div className="block w-full max-w-3xl">
            {/* The address bar: the URL opens the site, the button copies it.
                Two separate controls, so neither is nested inside the other's
                hit area. */}
            <div className="flex flex-row items-center gap-2 border rounded-md px-2 py-1">
              <GlobeIcon className="size-4 shrink-0" />
              <a
                href={column.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 font-mono text-sm break-all hover:underline"
              >
                {column.url!}
              </a>
              {/* The icon is small; the button isn't. Sizing comes from the
                  icon variant (and its coarse-pointer size) rather than being
                  overridden down to the glyph. */}
              <Button
                variant="ghost"
                size="icon"
                aria-label={urlCopied ? "Link copied" : "Copy link"}
                onClick={handleCopyUrl}
                className="shrink-0"
              >
                {urlCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
            <a href={column.url} target="_blank" rel="noreferrer" className="mt-2 block w-full">
              {imageSrc && !imageErrored ? (
                <img
                  src={imageSrc}
                  alt={urlTitle || "Website screenshot"}
                  onError={() => setImageErrored(true)}
                  className="w-full rounded-md"
                />
              ) : (
                <LinkPreviewEmpty url={column.url} />
              )}
            </a>
          </div>
        )}
      </div>
      <div className="w-full md:w-1/4 space-y-2 md:flex md:flex-col md:min-h-0">
        {/* Left, not right. The dialog's close button owns the top-right corner
            and its touch box reaches well into it, so a right-aligned Next sat
            directly under Close: reaching for one hit the other, and hitting
            Next by mistake discards the block being read. */}
        <div className="flex justify-start gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous column"
            disabled={!hasPrev}
            onClick={onPrev}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next column"
            disabled={!hasNext}
            onClick={onNext}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="border rounded-lg space-y-2 h-fit shrink-0">
          <DialogTitle>
            <Input
              ref={titleInputRef}
              placeholder="No title"
              disabled={!canEdit}
              value={title}
              className="border-none shadow-none"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveField(handleTitleChange);
                }
              }}
            />
          </DialogTitle>
          <DialogDescription>
            <Textarea
              ref={descriptionInputRef}
              placeholder="No description"
              disabled={!canEdit}
              value={description}
              rows={1}
              // field-sizing grows the box with its content; shift+Enter adds a
              // line, Enter saves.
              className="resize-none border-none shadow-none [field-sizing:content]"
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveField(handleDescriptionChange);
                }
              }}
            />
          </DialogDescription>
          {canEdit || column.tags.length > 0 ? (
            <div className="p-3">
              <TagInput tags={column.tags} onChange={handleTagsChange} disabled={!canEdit} />
            </div>
          ) : null}
          <div className="flex w-full justify-between text-xs p-3">
            <h3>Created on</h3>
            <p className="font-mono">{new Date(column.created_at).toDateString()}</p>
          </div>
          {column.created_by_handle ? (
            <div className="flex w-full justify-between text-xs p-3">
              <h3>Created by</h3>
              <Link href={`/${column.created_by_handle}`} className="font-mono hover:underline">
                @{column.created_by_handle}
              </Link>
            </div>
          ) : null}
          {/* Two rows, not one. Copy-to-channel used to sit 8px from Delete,
              which is close enough that a slip destroys the block instead of
              duplicating it; the confirmation was the only thing between them. */}
          <div className="flex w-full flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button asChild variant="link" size="sm">
                {/* Deep link, not the standalone block page: sharing this drops
                  the recipient on the channel with the block already open, so
                  closing it leaves them somewhere instead of nowhere. */}
                <Link href={`/${handle}/${column.channel_id}?block=${column.id}`}>
                  <LinkIcon className="size-3" />
                  Permalink
                </Link>
              </Button>
              {isDirty ? (
                <Button size="sm" onClick={handleSave}>
                  Save
                </Button>
              ) : null}
              {/* Move is owner-only (it removes the block from this channel). */}
              {isOwner && moveTargets.length > 0 ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Move to another channel"
                        disabled={moving}
                        onPointerEnter={move.warm}
                        onFocus={move.warm}
                        onClick={move.show}
                      >
                        <FolderInput />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move to another channel</TooltipContent>
                  </Tooltip>
                  {/* Searchable picker so it scales past a handful of channels. */}
                  {move.mounted ? (
                    <BlockChannelPicker
                      open={move.open}
                      onOpenChange={move.setOpen}
                      title="Move to channel"
                      description="Search your channels and move this column to one of them."
                      channels={moveTargets}
                      busy={moving}
                      onPick={handleMove}
                    />
                  ) : null}
                </>
              ) : null}
              {/* Copy needs only read access to this block, so any signed-in viewer
                with a channel of their own to copy into gets it — including on
                someone else's channel. */}
              {copyTargets.length > 0 ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Copy to another channel"
                        disabled={copying}
                        onPointerEnter={copy.warm}
                        onFocus={copy.warm}
                        onClick={copy.show}
                      >
                        <Copy />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy to one of your channels</TooltipContent>
                  </Tooltip>
                  {copy.mounted ? (
                    <BlockChannelPicker
                      open={copy.open}
                      onOpenChange={copy.setOpen}
                      title="Copy to channel"
                      description="Search your channels and copy this column into one of them."
                      channels={copyTargets}
                      busy={copying}
                      onPick={handleCopy}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
            {canEdit || isAdmin ? (
              <div className="flex justify-end border-t pt-2">
                {canEdit ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive-text hover:text-destructive-text"
                      onPointerEnter={confirmDelete.warm}
                      onFocus={confirmDelete.warm}
                      onClick={confirmDelete.show}
                    >
                      Delete
                    </Button>
                    {confirmDelete.mounted ? (
                      <DeleteBlockDialog
                        open={confirmDelete.open}
                        onOpenChange={confirmDelete.setOpen}
                        onConfirm={handleDelete}
                      />
                    ) : null}
                  </>
                ) : (
                  <AdminDeleteButton
                    label="Delete block"
                    description="Delete this block from a public channel as an admin. This can’t be undone."
                    size="sm"
                    onDelete={async () => {
                      await adminDeleteColumnAction(column.id);
                      setColumns((cols) => cols.filter((c) => c.id !== column.id));
                    }}
                  />
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className="border rounded-lg md:flex-1 md:min-h-0 md:overflow-hidden">
          <ColumnComments columnId={column.id} viewerId={viewerId} isOwner={isOwner} />
        </div>
      </div>
    </div>
  );
}
