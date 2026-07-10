"use client";

import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, GlobeIcon, LayersIcon, LinkIcon } from "lucide-react";
import { toast } from "sonner";
import ColumnComments from "./column-comments";
import type { Column } from "@/lib/colosseum/column";
import type { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import {
  deleteColumnAction,
  moveColumnAction,
  updateColumnDescriptionAction,
  updateColumnTagsAction,
  updateColumnTextAction,
  updateColumnTitleAction,
} from "@/lib/colosseum/actions";
import type { PickableChannel } from "@/components/add-block-drawer";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  handle: string;
  // The signed-in viewer's id, or null when signed out. Drives commenting.
  viewerId: string | null;
  setColumns: Dispatch<SetStateAction<Column[]>>;
  // The owner's channels, for the "Move" picker. Empty for non-owners.
  channels: PickableChannel[];
  screenshot?: ColumnScreenshot;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
};

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

  const imageURL = screenshot?.image_url ?? null;
  const urlTitle = screenshot?.title ?? "";
  const screenshotVersion = screenshot?.captured_at ?? null;

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

  // Channels the block can move to: the owner's, minus the one it's already in.
  const moveTargets = channels.filter((c) => c.id !== column.channel_id);
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
        {column.text ? (
          <Textarea
            ref={textInputRef}
            value={text}
            disabled={!canEdit}
            // Sizes to content (Textarea sets field-sizing-content, min-h-16);
            // caps at the panel height so a long block scrolls, not overflows.
            className="max-h-full"
            onChange={(e) => setText(e.target.value)}
          />
        ) : column.type === "image" ? (
          <img
            src={column.image}
            alt={column.title ?? "Image column"}
            className="max-h-[70vh] md:max-h-full max-w-full object-contain rounded-md"
          />
        ) : (
          <a href={column.url} target="_blank" className="block w-full max-w-3xl">
            <div className="flex flex-row items-center gap-2 border rounded-md px-2 py-1">
              <GlobeIcon className="size-4 shrink-0" />
              <span className="font-mono text-sm break-all">{column.url!}</span>
            </div>
            <div className="mt-2 w-full">
              {imageURL && !imageErrored ? (
                <img
                  src={
                    screenshotVersion
                      ? `${imageURL}?v=${encodeURIComponent(screenshotVersion)}`
                      : imageURL
                  }
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
            {isOwner && moveTargets.length > 0 ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={moving}
                  onClick={() => setMoveOpen(true)}
                >
                  Move
                </Button>
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
            {canEdit ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleDelete}
              >
                Delete
              </Button>
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
