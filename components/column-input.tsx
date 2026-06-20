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
      const data = await response.json();
      throw new Error(data);
    }
  };

  const handleTextAreaUpload = async () => {
    if (!user?.id || text === "") return;
    if (!channel) return;
    let column;
    try {
      if (isURL(text)) {
        // get proper url
        const urlText = text.startsWith("https://") ? text : "https://" + text;

        column = await uploadURLColumn(supabase, {
          created_by: user.id,
          channel_id: channel.id,
          text: urlText,
        });
        setLoading(true);
        await screenshotURL(urlText);
        setLoading(false);
      } else {
        column = await uploadTextColumn(supabase, {
          created_by: user.id,
          channel_id: channel.id,
          text,
        });
      }

      const newColumns = [column, ...columns];
      setColumns(newColumns);
      setText("");
      handleMetaData(channel!, newColumns);
    } catch (e) {
      console.error(e);
    }
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
          onChange={(e) => setText(e.target.value)}
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
    </div>
  );
}
