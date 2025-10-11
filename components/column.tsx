"use client";

import React, { useState, useRef, useEffect, memo } from "react";
import { Column } from "@/lib/colosseum/column";
import {
  updateColumnDescription,
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
import { timeAgo } from "@/lib/utils";
import { Textarea } from "./ui/textarea.";
import { Input } from "./ui/input";

type ColumnComponentProps = {
  column: Column;
  setColumns: React.Dispatch<React.SetStateAction<Column[]>>;
};

export default function ColumnComponent({
  column,
  setColumns,
}: ColumnComponentProps) {
  const [title, setTitle] = useState(column.title ?? "");
  const [description, setDescription] = useState(column.description ?? "");

  const [text, setText] = useState(column.text ?? "");

  const [showSave, setShowSave] = useState(false);

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
      descriptionInputRef.current?.blur();
    } catch (e) {
      console.error(e);
    }
  };

  const handleTextChange = async (column_id: number) => {
    await updateColumnText(supabase, column_id, text);
    textInputRef.current?.blur();
    // update column text
    setColumns((prev) =>
      prev.map((column) =>
        column.id === column_id ? { ...column, text: text } : column
      )
    );
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

      setShowSave(false);
    } catch (e) {
      console.error(e);
    }
  };

  const ScreenshotPreview = memo(function ({ url }: { url: string }) {
    // create client side supabase client

    const [image, setImage] = useState<string | null>(null);

    useEffect(() => {
      const fetchScreenshot = async () => {
        try {
          const res = await fetch(
            `/api/screenshot?url=${encodeURIComponent(url)}`
          );
          const data = await res.json();
          console.log(data);
          setImage(data.image_url);
        } catch (err) {
          console.error(err);
        }
      };

      fetchScreenshot();
    }, []);

    return (
      <div className="w-full h-full flex items-center justify-center">
        {image ? (
          <img
            src={image}
            alt={`Screenshot of ${url}`}
            className="w-full h-full object-cover rounded-lg"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center rounded-lg">
            <p className="text-gray-500 text-sm">Loading screenshot...</p>
          </div>
        )}
      </div>
    );
  });

  return (
    <Dialog>
      <DialogTrigger>
        <div className="group relative w-[300px]">
          <div className="w-[300px] h-[300px] border rounded-lg text-left p-2">
            {column.type === "text" ? (
              <p className="text-sm line-clamp-[10]">{column.text}</p>
            ) : (
              <ScreenshotPreview url={column.url!} />
            )}
          </div>
          <p className="opacity-0 group-hover:opacity-100 transition-opacity pt-1 text-xs font-light">
            {timeAgo(new Date(column.created_at))}
          </p>
        </div>
      </DialogTrigger>

      <DialogContent className="w-[97vw] !h-[97vh] !max-w-none p-4">
        <div className="flex pt-4 px-4">
          <div className="w-3/4 flex justify-center">
            <div className="flex w-3/4 p-6 rounded-md">
              {/* TODO: add ability to edit text in-line */}
              {column.text ? (
                <Textarea
                  ref={textInputRef}
                  value={text}
                  onChange={(e) => {
                    const oldText = column.text ?? "";

                    if (e.target.value !== oldText) {
                      setShowSave(true);
                    }
                    setText(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleTextChange(column.id);
                    }
                  }}
                />
              ) : (
                <p>TODO: URL VIEW HERE</p>
              )}
            </div>
          </div>
          <div className="w-1/4 border rounded-lg space-y-2">
            <DialogTitle>
              <Input
                ref={titleInputRef}
                placeholder="No title"
                value={title}
                className="border-none shadow-none"
                onChange={(e) => {
                  const oldTitle = column.title ?? "";
                  if (e.target.value !== oldTitle) {
                    setShowSave(true);
                  } else {
                    setShowSave(false);
                  }
                  setTitle(e.target.value);
                }}
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
                value={description}
                className="border-none shadow-none"
                onChange={(e) => {
                  const oldDescription = column.description ?? "";
                  if (e.target.value !== oldDescription) {
                    setShowSave(true);
                  } else {
                    setShowSave(false);
                  }
                  setDescription(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleDescriptionChange(column);
                  }
                }}
              />
            </DialogDescription>
            <div className="flex w-full justify-between text-xs p-3">
              <h3>Created on</h3>
              <p className="font-mono">
                {new Date(column.created_at).toDateString()}
              </p>
            </div>
            <div className="p-3 w-full flex justify-end">
              {showSave ? (
                <button
                  onClick={() => handleSave(column)}
                  className="text-xs underline font-light px-2"
                >
                  save
                </button>
              ) : null}
              <button
                className="text-xs underline font-light"
                onClick={() => {
                  handleDeleteColumn(column);
                }}
              >
                delete
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
