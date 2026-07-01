"use client";

import React, { useState, useRef, memo } from "react";
import { Column } from "@/lib/colosseum/column";
import {
  updateColumnDescription,
  updateColumnTags,
  updateColumnText,
  updateColumnTitle,
  deleteColumn,
} from "@/lib/colosseum/column";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { parseTags, timeAgo } from "@/lib/utils";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import ScreenShotPreview from "./screenshot-preview";
import { ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { GlobeIcon, LinkIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

type ColumnComponentProps = {
  column: Column;
  setColumns: React.Dispatch<React.SetStateAction<Column[]>>;
  isOwner: boolean;
  // Owner handle, used to build the block's permalink (/[handle]/[channel]/[id]).
  handle: string;
  // Screenshot data hydrated by the parent (one batched query for the whole
  // channel). `undefined` means "not loaded yet" for a URL column; a resolved
  // value may still have a null image_url when no screenshot exists.
  screenshot?: ColumnScreenshot;
};

const ColumnComponent = memo(function ColumnComponent({
  column,
  setColumns,
  isOwner,
  handle,
  screenshot,
}: ColumnComponentProps) {
  const [title, setTitle] = useState(column.title ?? "");
  const [description, setDescription] = useState(column.description ?? "");
  const [tags, setTags] = useState(column.tags.join(", "));

  const [text, setText] = useState(column.text ?? "");

  const imageURL = screenshot?.image_url ?? null;
  const urlTitle = screenshot?.title ?? "";
  // cache-busting token for the shared storage object (bumped on refresh)
  const screenshotVersion = screenshot?.captured_at ?? null;

  // Single source of truth for the "save" affordance: dirty when any editable
  // field differs from the persisted column. Avoids the per-input setShowSave
  // toggles that could clear the flag while another field was still edited.
  const isDirty =
    title !== (column.title ?? "") ||
    description !== (column.description ?? "") ||
    text !== (column.text ?? "") ||
    parseTags(tags).join(", ") !== column.tags.join(", ");
  // A URL column is still loading until the parent resolves its screenshot.
  const loading = column.type === "url" && screenshot === undefined;

  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  const supabase = createClient();

  const handleTitleChange = async (column: Column) => {
    const oldTitle = column.title ? column.title : "";

    if (oldTitle === title) {
      return;
    }

    try {
      await updateColumnTitle(supabase, column.id, title);
      setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, title } : c)));
      titleInputRef.current?.blur();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDescriptionChange = async (column: Column) => {
    const oldDescription = column.description ? column.description : "";

    if (oldDescription == description) {
      return;
    }

    try {
      await updateColumnDescription(supabase, column.id, description);
      setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, description } : c)));
      descriptionInputRef.current?.blur();
    } catch (e) {
      console.error(e);
    }
  };

  const handleTagsChange = async (column: Column) => {
    const newTags = parseTags(tags);
    if (newTags.join(", ") === column.tags.join(", ")) {
      return;
    }

    try {
      await updateColumnTags(supabase, column.id, newTags);
      setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, tags: newTags } : c)));
    } catch (e) {
      console.error(e);
    }
  };

  const handleTextChange = async (column_id: number) => {
    try {
      await updateColumnText(supabase, column_id, text);
      textInputRef.current?.blur();
      setColumns((prev) => prev.map((col) => (col.id === column_id ? { ...col, text } : col)));
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const handleDeleteColumn = async (column: Column) => {
    try {
      await deleteColumn(supabase, column.id);
      setColumns((columns) => columns.filter((c) => c.id !== column.id));
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async (column: Column) => {
    try {
      await handleTitleChange(column);
      await handleDescriptionChange(column);
      await handleTagsChange(column);
      if (text !== (column.text ?? "")) {
        await handleTextChange(column.id);
      }
      toast.success("Saved.");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't save. Please try again.");
    }
  };

  return (
    <Dialog>
      <DialogTrigger className="cv-card w-full">
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
            <p className="group-hover:hidden truncate pt-1 text-xs font-light">{urlTitle || " "}</p>
          ) : (
            <p className="pt-1 text-xs font-light opacity-0 group-hover:hidden select-none">
              placeholder
            </p>
          )}
          <p className="hidden group-hover:block pt-1 text-xs font-light">
            {timeAgo(new Date(column.created_at))}
          </p>
        </div>
      </DialogTrigger>
      <DialogContent className="w-[97vw] !h-[97vh] !max-w-none p-4">
        <div className="flex flex-col md:flex-row pt-4 px-4 gap-4 overflow-y-auto">
          <div className="w-full md:w-3/4 flex justify-center">
            <div className="flex w-full md:w-3/4 p-6 rounded-md">
              {column.text ? (
                <Textarea
                  ref={textInputRef}
                  value={text}
                  disabled={!isOwner}
                  onChange={(e) => setText(e.target.value)}
                />
              ) : column.type === "image" ? (
                <img
                  src={column.image}
                  alt={column.title ?? "Image block"}
                  className="max-h-[85vh] w-auto object-contain rounded-md"
                />
              ) : (
                <a href={column.url} target="_blank" className="size-11/12">
                  <div className="flex flex-row space-x-2 items-center border border-1 rounded-md px-2 py-1">
                    <GlobeIcon className="size-4" />
                    <h1 className="font-mono">{column.url!}</h1>
                  </div>
                  <div className="mt-2 w-full">
                    {imageURL ? (
                      <img
                        src={
                          screenshotVersion
                            ? `${imageURL}?v=${encodeURIComponent(screenshotVersion)}`
                            : imageURL
                        }
                        alt={urlTitle || "Website screenshot"}
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
          </div>
          <div className="w-full md:w-1/4 border rounded-lg space-y-2 h-fit">
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
                    handleTitleChange(column);
                  }
                }}
              />
            </DialogTitle>
            <DialogDescription>
              <Input
                ref={descriptionInputRef}
                placeholder="No description"
                disabled={!isOwner}
                value={description}
                className="border-none shadow-none"
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleDescriptionChange(column);
                  }
                }}
              />
            </DialogDescription>
            <div className="px-3 space-y-1">
              <Label htmlFor={`tags-${column.id}`} className="text-xs font-light">
                Tags
              </Label>
              {isOwner ? (
                <Input
                  id={`tags-${column.id}`}
                  placeholder="comma, separated, tags"
                  value={tags}
                  className="border-none shadow-none px-0"
                  onChange={(e) => setTags(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleTagsChange(column);
                    }
                  }}
                />
              ) : column.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {column.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex w-full justify-between text-xs p-3">
              <h3>Created on</h3>
              <p className="font-mono">{new Date(column.created_at).toDateString()}</p>
            </div>
            <div className="p-3 w-full flex justify-end items-center gap-2">
              <Link
                href={`/${handle}/${column.channel_id}/${column.id}`}
                className="text-xs underline font-light flex items-center gap-1"
              >
                <LinkIcon className="size-3" />
                permalink
              </Link>
              {isDirty ? (
                <button
                  onClick={() => handleSave(column)}
                  className="text-xs underline font-light px-2"
                >
                  save
                </button>
              ) : null}
              {isOwner ? (
                <button
                  className="text-xs underline font-light"
                  onClick={() => {
                    handleDeleteColumn(column);
                  }}
                >
                  delete
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default ColumnComponent;
