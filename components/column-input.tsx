"use client";

import { Dispatch, SetStateAction, useState, useRef } from "react";
import {
  uploadURLColumnAction,
  uploadTextColumnAction,
  uploadImageColumnAction,
  uploadImageColumnFromUrlAction,
  uploadPdfColumnAction,
  updateColumnMetaAction,
} from "@/lib/colosseum/actions";
import type { Column } from "@/lib/colosseum/column";
import { imageSrcFromHtml, isURL } from "@/lib/utils";
import type { SessionUser } from "@/components/channel-board";
import type { Channel } from "@/lib/colosseum/channel";
import { Spinner } from "./ui/spinner";
import { toast } from "sonner";

// Kept in sync with the server-side limits in lib/colosseum/blob.ts.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB
const PDF_TYPE = "application/pdf";
// A dropped .md file becomes a (markdown) text block. Cap the source and reject
// anything that isn't plain text.
const MAX_MD_BYTES = 256 * 1024; // 256KB
const isMarkdownFile = (f: File) => f.type === "text/markdown" || /\.(md|markdown)$/i.test(f.name);

type ColumnInputProps = {
  user: SessionUser | null;
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
  const [uploading, setUploading] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const loading = uploading > 0;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFilesUpload(e.target.files);
    // Reset so picking the same file(s) again still fires onChange.
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files?.length) handleFilesUpload(e.dataTransfer.files);
  };

  // Paste image(s) straight into a block — a clipboard screenshot or a copied
  // image file. Text/URL pastes fall through to the textarea (submit with
  // Enter), so only swallow the event when there's actually an image.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    e.preventDefault();
    // A web-copied image also carries its source URL; prefer that so a pasted
    // GIF stays animated (the clipboard file is a flattened snapshot). A plain
    // clipboard screenshot has no such URL and uses the file directly.
    uploadPastedImages(imageSrcFromHtml(e.clipboardData.getData("text/html")), images);
  };

  // Prefer the copied image's source URL (fetched server-side into an image
  // column) and fall back to the clipboard's rasterized file if that fetch
  // fails — a relative/blob src, a private image, a dead link, etc.
  const uploadPastedImages = async (sourceUrl: string | null, files: File[]) => {
    if (!user?.id || !channel) return;
    if (sourceUrl) {
      setUploading(1);
      try {
        const column = await uploadImageColumnFromUrlAction(channel.id, sourceUrl);
        setColumns((prev) => [column, ...prev]);
        onBlockAdded();
        return;
      } catch (err) {
        console.error(err);
      } finally {
        setUploading(0);
      }
    }
    await handleFilesUpload(files);
  };

  // Upload one or more dropped/picked files, creating a block per file: images
  // and PDFs go to blob storage as image/pdf blocks; .md files become markdown
  // text blocks. Type/size are validated here for fast feedback (blobs are
  // re-checked server-side). Invalid files are reported and skipped; valid ones
  // process sequentially so a big multi-drop doesn't fire dozens of requests at
  // once. Newest ends up on top.
  const handleFilesUpload = async (fileList: FileList | File[]) => {
    if (!user?.id || !channel) return;

    const valid: File[] = [];
    for (const f of Array.from(fileList)) {
      const isImage = ALLOWED_IMAGE_TYPES.includes(f.type);
      const isPdf = f.type === PDF_TYPE;
      const isMd = isMarkdownFile(f);
      if (!isImage && !isPdf && !isMd) {
        toast.error(
          `${f.name}: only image files (PNG, JPEG, GIF, WebP, AVIF), PDFs, or Markdown (.md) files are supported.`,
        );
      } else if (isMd ? f.size > MAX_MD_BYTES : isPdf ? f.size > MAX_PDF_BYTES : f.size > MAX_IMAGE_BYTES) {
        toast.error(`${f.name} is too large (max ${isMd ? "256KB" : isPdf ? "25MB" : "10MB"}).`);
      } else {
        valid.push(f);
      }
    }
    if (valid.length === 0) return;

    setUploading(valid.length);
    const created: Column[] = [];
    try {
      for (const f of valid) {
        if (isMarkdownFile(f)) {
          const md = await f.text();
          // A binary file renamed .md reads as garbage with NUL bytes — reject
          // it rather than storing a non-text blob.
          if (md.includes("\u0000")) {
            toast.error(`${f.name}: not a text file.`);
          } else {
            created.push(await uploadTextColumnAction({ channelId: channel.id, text: md }));
          }
        } else {
          const formData = new FormData();
          formData.set("channelId", String(channel.id));
          formData.set("file", f);
          created.push(
            f.type === PDF_TYPE
              ? await uploadPdfColumnAction(formData)
              : await uploadImageColumnAction(formData),
          );
        }
        setUploading((n) => n - 1);
      }
    } catch (e) {
      console.error(e);
      toast.error("Couldn't upload one or more files. Please try again.");
    } finally {
      setUploading(0);
    }

    if (created.length > 0) {
      setColumns((prev) => [...created.reverse(), ...prev]);
      created.forEach(() => onBlockAdded());
    }
  };

  const screenshotURL = async (url: string) => {
    // Same-origin request — the session cookie authenticates it server-side.
    const response = await fetch("/api/screenshot", {
      method: "POST",
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
        column = await uploadURLColumnAction({
          channelId: channel.id,
          text: urlText,
        });
      } else {
        column = await uploadTextColumnAction({
          channelId: channel.id,
          text,
        });
      }
    } catch (e) {
      console.error(e);
      toast.error("Couldn't add that column. Please try again.");
      return;
    }

    // 2) Show the block and hand control back to the parent right away (which
    // closes the add-block modal) — the screenshot is captured afterwards.
    setColumns([column, ...columns]);
    setText("");
    onBlockAdded();

    if (!isUrlInput) {
      toast.success("Column added.");
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
          await updateColumnMetaAction(newColumn.id, patch);
          setColumns((prev) => prev.map((c) => (c.id === newColumn.id ? { ...c, ...patch } : c)));
        }
      } catch (e) {
        console.error(e);
        toast.warning("Column added, but the screenshot for that link couldn't be captured.");
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
      {/* Text input. text-base (16px), not text-sm — iOS Safari auto-zooms on
          focus of any input smaller than 16px. */}
      <textarea
        ref={textareaRef}
        disabled={loading}
        className={`w-full h-full bg-transparent resize-none focus:outline-none p-3 leading-normal text-base ${loading ? "hidden" : ""}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onPaste={handlePaste}
        placeholder=""
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleTextAreaUpload();
          }
        }}
      />

      {/* Overlay placeholder with clickable Upload */}
      {!text && !loading && (
        <div className="absolute inset-0 px-3 pt-3 text-base leading-normal text-gray-500 flex items-start pointer-events-none">
          <span>
            Type, paste an image, or{" "}
            <label className="underline cursor-pointer pointer-events-auto">
              upload
              <input
                type="file"
                accept="image/*,application/pdf,.md,.markdown,text/markdown"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </label>{" "}
            — one or many.
          </span>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex flex-col gap-2 items-center justify-center bg-gray-100/60 dark:bg-black/50 z-10">
          <Spinner variant="circle" className="size-10" />
          {uploading > 1 ? (
            <p className="text-xs text-muted-foreground">{uploading} left…</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
