"use client";

import { createClient } from "@/lib/supabase/client";
import { Dispatch, SetStateAction, useState, useRef } from "react";
import {
  uploadURLColumn,
  uploadTextColumn,
  uploadImageColumn,
  updateColumnMeta,
  Column,
} from "@/lib/colosseum/column";
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
  // Notify the parent that a block was added so it can update channel stats.
  onBlockAdded: () => void;
  // A URL block's screenshot is captured after the block already shows in the
  // list. `onScreenshotStart` fires when the capture begins (so the row shows a
  // spinner); `onScreenshotReady` fires when it lands (rehydrate the preview).
  onScreenshotStart?: (url: string) => void;
  onScreenshotReady?: (url: string) => void;
};

export default function ColumnInput({
  user,
  columns,
  setColumns,
  channel,
  onBlockAdded,
  onScreenshotStart,
  onScreenshotReady,
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

      setColumns([column, ...columns]);
      onBlockAdded();
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
      return null;
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

    // The route echoes the page's title/description (from the screenshot pass)
    // so a new URL block can pre-fill them.
    const body = await response.json().catch(() => null);
    return body as { title?: string; description?: string } | null;
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
      toast.error("Couldn't add that block. Please try again.");
      return;
    }

    // 2) Show the block and hand control back to the parent right away (which
    // closes the add-block modal) — the screenshot is captured afterwards.
    setColumns([column, ...columns]);
    setText("");
    onBlockAdded();

    if (!isUrlInput) {
      toast.success("Block added.");
      return;
    }

    // Mark the row as capturing so it shows a spinner until the shot lands. This
    // batches with the add above, so the row never flashes an empty preview.
    onScreenshotStart?.(urlText);

    // 3) Capture the URL's screenshot in the background. The block is already in
    // the list, so this runs detached — this component (inside the modal) may
    // already be unmounted, so it only touches parent state. When the capture
    // lands, patch the block's metadata and refresh its preview.
    const newColumn = column;
    void (async () => {
      try {
        const meta = await screenshotURL(urlText);
        // Fill title/description from the page metadata, but only fields the
        // user left empty so a manual edit is never clobbered.
        const patch: { title?: string; description?: string } = {};
        if (meta?.title && !newColumn.title) patch.title = meta.title;
        if (meta?.description && !newColumn.description) patch.description = meta.description;
        if (Object.keys(patch).length > 0) {
          await updateColumnMeta(supabase, newColumn.id, patch);
          setColumns((prev) => prev.map((c) => (c.id === newColumn.id ? { ...c, ...patch } : c)));
        }
      } catch (e) {
        console.error(e);
        toast.warning("Block added, but the screenshot for that link couldn't be captured.");
      } finally {
        // Always clear the capturing state — on failure this refetches to a
        // null preview (so the spinner stops); on success, the real shot.
        onScreenshotReady?.(urlText);
      }
    })();
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
