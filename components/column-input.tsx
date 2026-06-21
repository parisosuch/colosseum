"use client";

import { createClient } from "@/lib/supabase/client";
import { Dispatch, SetStateAction, useState, useRef } from "react";
import { uploadURLColumn, uploadTextColumn, Column } from "@/lib/colosseum/column";
import { isURL } from "@/lib/utils";
import { User } from "@supabase/supabase-js";
import { Channel } from "@/lib/colosseum/channel";
import { Spinner } from "./ui/spinner";

type ColumnInputProps = {
  user: User | null;
  columns: Column[];
  setColumns: Dispatch<SetStateAction<Column[]>>;
  channel: Channel | null;
  handleMetaData: (channel: Channel, columns: Column[]) => void;
};

export default function ColumnInput({
  user,
  columns,
  setColumns,
  channel,
  handleMetaData,
}: ColumnInputProps) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const supabase = createClient();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) setFile(droppedFile);

    // TODO: handle upload on drop
  };

  const screenshotURL = async (url: string) => {
    const { data } = await supabase.auth.getSession();

    if (!data.session) {
      console.error("User is not auth.");
      return;
    }

    const response = await fetch("/api/screenshot", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + data.session.access_token,
      },
      body: JSON.stringify({ url: url }),
    });

    if (response.status !== 200) {
      const body = await response.json().catch(() => null);
      const message = typeof body?.error === "string" ? body.error : "Failed to capture screenshot.";
      throw new Error(message);
    }
  };

  const handleTextAreaUpload = async () => {
    if (!user?.id || text === "") return;
    if (!channel) return;

    setError(null);

    const isUrlInput = isURL(text);
    const urlText = text.startsWith("https://") ? text : "https://" + text;

    // 1) Insert the column row. If this fails, surface it and stop — nothing
    // was created.
    let column: Column;
    try {
      if (isUrlInput) {
        column = await uploadURLColumn(supabase, {
          created_by: user.id,
          channel_id: channel.id,
          text: urlText,
        });
      } else {
        column = await uploadTextColumn(supabase, {
          created_by: user.id,
          channel_id: channel.id,
          text,
        });
      }
    } catch (e) {
      console.error(e);
      setError("Couldn't add that block. Please try again.");
      return;
    }

    // 2) For URL columns, capture a screenshot. A failure here must NOT block
    // the column from appearing — it's already inserted, and the preview falls
    // back to "no screenshot". Always clear loading via finally so the spinner
    // can never get stuck.
    if (isUrlInput) {
      setLoading(true);
      try {
        await screenshotURL(urlText);
      } catch (e) {
        console.error(e);
        setError("Block added, but the screenshot for that link couldn't be captured.");
      } finally {
        setLoading(false);
      }
    }

    // 3) Show the column regardless of the screenshot outcome.
    const newColumns = [column, ...columns];
    setColumns(newColumns);
    setText("");
    handleMetaData(channel, newColumns);
  };

  return (
    <div
      className={`relative w-[300px] h-[300px] rounded-lg dark:bg-white/10 bg-gray-100 
        ${isDragging ? "border-2 border-dashed dark:border-white/20 border-gray-200" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      {/* Text input */}
      {!file && (
        <textarea
          ref={textareaRef}
          disabled={loading}
          className={`w-full h-full bg-transparent resize-none focus:outline-none p-3 leading-normal text-sm ${loading ? "hidden" : ""}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          placeholder=""
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleTextAreaUpload();
            }
          }}
        />
      )}

      {/* Overlay placeholder with clickable Upload */}
      {!text && !file && (
        <div className="absolute inset-0 px-3 pt-3 text-sm leading-normal text-gray-500 flex items-start pointer-events-none">
          <span className="pointer-events-auto">
            Type here... or{" "}
            <label className="underline cursor-pointer">
              upload file
              <input type="file" className="hidden" onChange={handleFileChange} />
            </label>{" "}
            or drop a file
          </span>
        </div>
      )}

      {/* Show file name if file is selected */}
      {file && (
        <div className="absolute inset-0 flex items-center justify-center text-center text-sm break-all px-3">
          <p>{file.name}</p>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100/60 dark:bg-black/50 z-10">
          <Spinner variant="circle" className="size-10" />
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-x-0 bottom-0 z-20 rounded-b-lg bg-red-500/90 p-2 text-xs text-white">
          {error}
        </div>
      )}
    </div>
  );
}
