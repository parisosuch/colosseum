"use client";

import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderInput,
  GlobeIcon,
  LayersIcon,
  LinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import ColumnComments from "./column-comments";
import { Markdown } from "./markdown";
import TweetBlock from "./tweet-block";
import YouTubeBlock from "./youtube-block";
import SpotifyBlock from "./spotify-block";
import YouTubeChannelBlock from "./youtube-channel-block";
import { screenshotSrc, spotifyEmbedRef, tweetIdFromUrl, youtubeIdFromUrl } from "@/lib/utils";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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

// A text block is markdown. Viewers see it rendered; editors get GitHub-style
// Write/Preview tabs over a monospace textarea (raw syntax stays visible while
// writing), Preview rendering the current draft.
function MarkdownEditor({
  text,
  setText,
  canEdit,
  textRef,
}: {
  text: string;
  setText: (v: string) => void;
  canEdit: boolean;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  // Default to Preview (rendered markdown) — editors switch to Write to edit.
  const [mode, setMode] = useState<"write" | "preview">("preview");

  if (!canEdit) {
    return (
      <div className="w-full max-h-full overflow-y-auto">
        <Markdown text={text} />
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
          {text.trim() ? (
            <Markdown text={text} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
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

  const handleTitleChange = async () => {
    if ((column.title ?? "") === title) return;
    try {
      await updateColumnTitleAction(column.id, title);
      setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, title } : c)));
      titleInputRef.current?.blur();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDescriptionChange = async () => {
    if ((column.description ?? "") === description) return;
    try {
      await updateColumnDescriptionAction(column.id, description);
      setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, description } : c)));
      descriptionInputRef.current?.blur();
    } catch (e) {
      console.error(e);
    }
  };

  const handleTextChange = async () => {
    await updateColumnTextAction(column.id, text);
    textInputRef.current?.blur();
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, text } : c)));
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

  const handleDelete = async () => {
    try {
      await deleteColumnAction(column.id);
      // Dropping the block clears the open id in the parent, which closes here.
      setColumns((cols) => cols.filter((c) => c.id !== column.id));
    } catch (e) {
      console.error(e);
    }
  };

  // Channels the block can move/copy to: the viewer's own, minus the one it's
  // already in. (On someone else's channel, none is excluded — it isn't yours.)
  const moveTargets = channels.filter((c) => c.id !== column.channel_id);
  const copyTargets = moveTargets;
  const [moveOpen, setMoveOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  const handleMove = async (targetChannelId: number) => {
    if (moving) return;
    setMoving(true);
    try {
      await moveColumnAction(column.id, targetChannelId);
      setMoveOpen(false);
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

  const [copyOpen, setCopyOpen] = useState(false);
  const [copying, setCopying] = useState(false);

  // Copy leaves the source in place, so — unlike move — the current board is
  // untouched; the duplicate lands in the target channel.
  const handleCopy = async (targetChannelId: number) => {
    if (copying) return;
    setCopying(true);
    try {
      await copyColumnAction(column.id, targetChannelId);
      setCopyOpen(false);
      toast.success("Copied.");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't copy that column. Please try again.");
    } finally {
      setCopying(false);
    }
  };

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
          <MarkdownEditor text={text} setText={setText} canEdit={canEdit} textRef={textInputRef} />
        ) : column.type === "image" ? (
          <img
            src={column.image}
            alt={column.title ?? "Image column"}
            className="max-h-[70vh] md:max-h-full max-w-full object-contain rounded-md"
          />
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
            <span className="max-w-full font-serif text-2xl font-medium">
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
          <a href={column.url} target="_blank" className="block w-full max-w-3xl">
            <div className="flex flex-row items-center gap-2 border rounded-md px-2 py-1">
              <GlobeIcon className="size-4 shrink-0" />
              <span className="font-mono text-sm break-all">{column.url!}</span>
            </div>
            <div className="mt-2 w-full">
              {imageSrc && !imageErrored ? (
                <img
                  src={imageSrc}
                  alt={urlTitle || "Website screenshot"}
                  onError={() => setImageErrored(true)}
                  className="w-full rounded-md"
                />
              ) : (
                <div className="w-full rounded-md border p-4 text-center text-sm text-muted-foreground">
                  No screenshot available
                </div>
              )}
            </div>
          </a>
        )}
      </div>
      <div className="w-full md:w-1/4 space-y-2 md:flex md:flex-col md:min-h-0">
        <div className="flex justify-end gap-1 shrink-0">
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
                  handleTitleChange();
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
                  handleDescriptionChange();
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
          <div className="p-3 w-full flex justify-end items-center gap-2">
            <Button asChild variant="link" size="sm">
              <Link href={`/${handle}/${column.channel_id}/${column.id}`}>
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
                      onClick={() => setMoveOpen(true)}
                    >
                      <FolderInput />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Move to another channel</TooltipContent>
                </Tooltip>
                {/* Searchable picker so it scales past a handful of channels. */}
                <CommandDialog
                  open={moveOpen}
                  onOpenChange={setMoveOpen}
                  title="Move to channel"
                  description="Search your channels and move this column to one of them."
                >
                  <CommandInput placeholder="Search channels…" />
                  <CommandList>
                    <CommandEmpty>No channels found.</CommandEmpty>
                    {moveTargets.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`channel-${c.id}`}
                        keywords={[c.title]}
                        disabled={moving}
                        onSelect={() => handleMove(c.id)}
                      >
                        <LayersIcon />
                        <span className="truncate">{c.title}</span>
                        {c.private ? (
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            private
                          </span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandList>
                </CommandDialog>
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
                      onClick={() => setCopyOpen(true)}
                    >
                      <Copy />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy to one of your channels</TooltipContent>
                </Tooltip>
                <CommandDialog
                  open={copyOpen}
                  onOpenChange={setCopyOpen}
                  title="Copy to channel"
                  description="Search your channels and copy this column into one of them."
                >
                  <CommandInput placeholder="Search channels…" />
                  <CommandList>
                    <CommandEmpty>No channels found.</CommandEmpty>
                    {copyTargets.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`channel-${c.id}`}
                        keywords={[c.title]}
                        disabled={copying}
                        onSelect={() => handleCopy(c.id)}
                      >
                        <LayersIcon />
                        <span className="truncate">{c.title}</span>
                        {c.private ? (
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            private
                          </span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandList>
                </CommandDialog>
              </>
            ) : null}
            {canEdit ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this block?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes the block from the channel. This can’t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-destructive/90"
                      onClick={handleDelete}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : isAdmin ? (
              <AdminDeleteButton
                label="Delete block"
                description="Delete this block from a public channel as an admin. This can’t be undone."
                size="sm"
                onDelete={async () => {
                  await adminDeleteColumnAction(column.id);
                  setColumns((cols) => cols.filter((c) => c.id !== column.id));
                }}
              />
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
