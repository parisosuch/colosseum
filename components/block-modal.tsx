"use client";

import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, GlobeIcon, LinkIcon } from "lucide-react";
import { toast } from "sonner";

import {
  Column,
  deleteColumn,
  updateColumnDescription,
  updateColumnText,
  updateColumnTitle,
} from "@/lib/colosseum/column";
import { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type BlockModalProps = {
  // The block to show, or null when nothing is open. The channel board owns this.
  column: Column | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOwner: boolean;
  handle: string;
  setColumns: Dispatch<SetStateAction<Column[]>>;
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
  handle,
  setColumns,
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
      <DialogContent
        className="w-[97vw] h-auto max-h-[95vh] md:!h-[97vh] !max-w-none p-4 outline-none"
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
            handle={handle}
            setColumns={setColumns}
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
  handle,
  setColumns,
  screenshot,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  column: Column;
  isOwner: boolean;
  handle: string;
  setColumns: Dispatch<SetStateAction<Column[]>>;
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

  const supabase = createClient();

  const handleTitleChange = async () => {
    if ((column.title ?? "") === title) return;
    try {
      await updateColumnTitle(supabase, column.id, title);
      setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, title } : c)));
      titleInputRef.current?.blur();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDescriptionChange = async () => {
    if ((column.description ?? "") === description) return;
    try {
      await updateColumnDescription(supabase, column.id, description);
      setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, description } : c)));
      descriptionInputRef.current?.blur();
    } catch (e) {
      console.error(e);
    }
  };

  const handleTextChange = async () => {
    await updateColumnText(supabase, column.id, text);
    textInputRef.current?.blur();
    setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, text } : c)));
  };

  const handleDelete = async () => {
    try {
      await deleteColumn(supabase, column.id);
      // Dropping the block clears the open id in the parent, which closes here.
      setColumns((cols) => cols.filter((c) => c.id !== column.id));
    } catch (e) {
      console.error(e);
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
      className="flex flex-col md:flex-row pt-4 px-4 gap-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-full items-start justify-center p-2 md:w-3/4 md:p-6">
        {column.text ? (
          <Textarea
            ref={textInputRef}
            value={text}
            disabled={!isOwner}
            className="min-h-[50vh]"
            onChange={(e) => setText(e.target.value)}
          />
        ) : column.type === "image" ? (
          <img
            src={column.image}
            alt={column.title ?? "Image block"}
            className="max-h-[85vh] w-auto object-contain rounded-md"
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
      <div className="w-full md:w-1/4 space-y-2">
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous block"
            disabled={!hasPrev}
            onClick={onPrev}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next block"
            disabled={!hasNext}
            onClick={onNext}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="border rounded-lg space-y-2 h-fit">
          <DialogTitle>
            <Input
              ref={titleInputRef}
              placeholder="No title"
              disabled={!isOwner}
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
              disabled={!isOwner}
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
            {isOwner ? (
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
      </div>
    </div>
  );
}
