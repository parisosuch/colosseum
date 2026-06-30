"use client";

import { createClient } from "@/lib/supabase/client";
import { Dispatch, SetStateAction, useState, useRef } from "react";
import { createBlock, uploadImageColumn, Column } from "@/lib/colosseum/column";
import { isURL } from "@/lib/utils";
import { User } from "@supabase/supabase-js";
import { Channel } from "@/lib/colosseum/channel";
import { Spinner } from "./ui/spinner";
import { toast } from "sonner";

// Kept in sync with the `blocks` bucket constraints in supabase/config.toml.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];

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
    if (selected) handleFileUpload(selected);
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) handleFileUpload(droppedFile);
  };

  // Upload an image file to the `blocks` bucket and create an image column.
  // Validates type/size client-side (the bucket enforces the same limits as a
  // backstop). On any failure nothing is created and the error is surfaced.
  const handleFileUpload = async (selected: File) => {
    if (!user?.id || !channel) return;

    if (!ALLOWED_IMAGE_TYPES.includes(selected.type)) {
      toast.error("Only image files (PNG, JPEG, GIF, WebP, AVIF) are supported.");
      return;
    }
    if (selected.size > MAX_IMAGE_BYTES) {
      toast.error("That image is too large (max 10MB).");
      return;
    }

    setFile(selected);
    setLoading(true);
    try {
      const ext = selected.name.split(".").pop()?.toLowerCase() || "bin";
      // Per-user prefix so storage RLS can gate writes to the owner's folder.
      const path = `${user.id}/${channel.id}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("blocks")
        .upload(path, selected, { contentType: selected.type, upsert: false });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("blocks").getPublicUrl(path);

      const column = await uploadImageColumn(supabase, {
        created_by: user.id,
        channel_id: channel.id,
        image: publicUrl,
      });

      const newColumns = [column, ...columns];
      setColumns(newColumns);
      handleMetaData(channel, newColumns);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't upload that image. Please try again.");
    } finally {
      setLoading(false);
      setFile(null);
    }
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
      const message =
        typeof body?.error === "string" ? body.error : "Failed to capture screenshot.";
      throw new Error(message);
    }
  };

  const handleTextAreaUpload = async () => {
    if (!user?.id || text === "") return;
    if (!channel) return;

    const isUrlInput = isURL(text);
    const urlText = text.startsWith("https://") ? text : "https://" + text;

    // 1) Insert the column row. If this fails, surface it and stop — nothing
    // was created.
    let column: Column;
    try {
      column = isUrlInput
        ? await createBlock(supabase, { type: "url", channel_id: channel.id, url: urlText })
        : await createBlock(supabase, { type: "text", channel_id: channel.id, text });
    } catch (e) {
      console.error(e);
      toast.error("Couldn't add that block. Please try again.");
      return;
    }

    // 2) For URL columns, capture a screenshot. A failure here must NOT block
    // the column from appearing — it's already inserted, and the preview falls
    // back to "no screenshot". Always clear loading via finally so the spinner
    // can never get stuck.
    let screenshotFailed = false;
    if (isUrlInput) {
      setLoading(true);
      try {
        await screenshotURL(urlText);
      } catch (e) {
        console.error(e);
        screenshotFailed = true;
      } finally {
        setLoading(false);
      }
    }

    // 3) Show the column regardless of the screenshot outcome.
    const newColumns = [column, ...columns];
    setColumns(newColumns);
    setText("");
    handleMetaData(channel, newColumns);
    if (screenshotFailed) {
      toast.warning("Block added, but the screenshot for that link couldn't be captured.");
    } else {
      toast.success("Block added.");
    }
  };

  return (
    <div
      className={`relative w-full aspect-square rounded-lg dark:bg-white/10 bg-gray-100
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
          <span>
            Type here... or{" "}
            <label className="underline cursor-pointer pointer-events-auto">
              upload an image
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>{" "}
            or drop one
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
