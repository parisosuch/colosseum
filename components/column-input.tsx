"use client";

import { Dispatch, SetStateAction, useEffect, useState, useRef } from "react";
import {
  uploadURLColumnAction,
  uploadTextColumnAction,
  uploadImageColumnAction,
  uploadImageColumnFromUrlAction,
  uploadPdfColumnAction,
  updateColumnMetaAction,
  getColumnQuotaAction,
} from "@/lib/colosseum/actions";
import type { Column } from "@/lib/colosseum/column";
import { columnLimitMessage } from "@/lib/quota";
import { imageSrcFromHtml, instagramRef, isURL } from "@/lib/utils";
import { resumeVideoUploads, startVideoUpload, type UploadHandlers } from "@/lib/resumable-upload";
import type { SessionUser } from "@/components/channel-board";
import type { Channel } from "@/lib/colosseum/channel";
import { GradientSpin } from "./gradient-spin";
import { Button } from "./ui/button";
import { toast } from "sonner";

// On an add failure, prefer a specific "you hit your column limit" message
// (fetched fresh, since the server-side reason is sanitized in prod) over the
// generic fallback.
async function columnLimitToast(fallback: string): Promise<string> {
  const quota = await getColumnQuotaAction().catch(() => null);
  return (quota && columnLimitMessage(quota, quota.admins)) || fallback;
}

// Kept in sync with the server-side limits in lib/colosseum/blob.ts.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB
const PDF_TYPE = "application/pdf";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];
// A dropped .md file becomes a (markdown) text block. Cap the source and reject
// anything that isn't plain text.
const MAX_MD_BYTES = 256 * 1024; // 256KB
const isMarkdownFile = (f: File) => f.type === "text/markdown" || /\.(md|markdown)$/i.test(f.name);

// One video file in flight: the resumable endpoint reports progress against it
// while the block is created in the background.
type ActiveUpload = { filename: string; sent: number; total: number; error?: string };

export type ColumnUploader = {
  // Create a block per dropped or picked file.
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  // Paste path: prefer the copied image's source URL, fall back to its bytes.
  uploadPastedImages: (sourceUrl: string | null, files: File[]) => Promise<void>;
  // Files still in flight in the sequential (image / PDF / markdown) loop.
  uploading: number;
  // Background video uploads, keyed by fingerprint.
  videoUploads: Record<string, ActiveUpload>;
};

// The file side of adding blocks, owned by the channel board rather than by the
// input tile. A drop anywhere on the board and a drop on the tile have to land
// in the same uploader, and in list view the tile isn't mounted at all. One
// instance per board — a second would resume the same pending video uploads a
// second time.
export function useColumnUpload({
  user,
  channel,
  setColumns,
  onBlockAdded,
}: {
  user: SessionUser | null;
  channel: Channel | null;
  setColumns: Dispatch<SetStateAction<Column[]>>;
  onBlockAdded: () => void;
}): ColumnUploader {
  const [uploading, setUploading] = useState(0);
  const [videoUploads, setVideoUploads] = useState<Record<string, ActiveUpload>>({});

  // Latest handlers in a ref so the resume effect can read them without
  // re-running when a parent callback changes identity.
  const uploadHandlersRef = useRef<UploadHandlers>({});
  uploadHandlersRef.current = {
    onStart: (fp, filename, total) =>
      setVideoUploads((u) => ({ ...u, [fp]: { filename, sent: u[fp]?.sent ?? 0, total } })),
    onProgress: (fp, sent, total) =>
      setVideoUploads((u) => ({
        ...u,
        [fp]: { filename: u[fp]?.filename ?? "", sent, total },
      })),
    onComplete: (fp, column) => {
      setVideoUploads((u) => {
        const next = { ...u };
        delete next[fp];
        return next;
      });
      setColumns((prev) => [column, ...prev]);
      onBlockAdded();
      toast.success("Video uploaded.");
    },
    onError: (fp, message) =>
      setVideoUploads((u) => ({
        ...u,
        [fp]: {
          filename: u[fp]?.filename ?? "",
          sent: u[fp]?.sent ?? 0,
          total: u[fp]?.total ?? 0,
          error: message,
        },
      })),
  };

  // On mount / channel change, resume any video upload this browser left pending
  // (a refresh or navigation mid-upload) for this channel.
  const channelId = channel?.id ?? null;
  useEffect(() => {
    if (channelId == null || !user?.id) return;
    resumeVideoUploads(channelId, uploadHandlersRef.current);
  }, [channelId, user?.id]);

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
        toast.success("Image added.");
        return;
      } catch (err) {
        console.error(err);
      } finally {
        setUploading(0);
      }
    }
    await handleFilesUpload(files);
  };

  // Upload one or more dropped/picked files, creating a block per file: images,
  // videos, and PDFs go to blob storage as image/video/pdf blocks; .md files become markdown
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
      const isVideo = ALLOWED_VIDEO_TYPES.includes(f.type);
      const isMd = isMarkdownFile(f);
      if (!isImage && !isPdf && !isVideo && !isMd) {
        toast.error(
          `${f.name}: only image files (PNG, JPEG, GIF, WebP, AVIF), videos (MP4, WebM, MOV, OGG), PDFs, or Markdown (.md) files are supported.`,
        );
      } else if (
        isMd
          ? f.size > MAX_MD_BYTES
          : isPdf
            ? f.size > MAX_PDF_BYTES
            : isVideo
              ? f.size > MAX_VIDEO_BYTES
              : f.size > MAX_IMAGE_BYTES
      ) {
        toast.error(
          `${f.name} is too large (max ${isMd ? "256KB" : isPdf ? "25MB" : isVideo ? "100MB" : "10MB"}).`,
        );
      } else {
        valid.push(f);
      }
    }
    if (valid.length === 0) return;

    // Videos upload in the background via the resumable endpoint (chunked, so a
    // refresh resumes them) — they don't block the sequential loop below.
    const videos = valid.filter((f) => ALLOWED_VIDEO_TYPES.includes(f.type));
    for (const f of videos) {
      void startVideoUpload(f, channel.id, uploadHandlersRef.current);
    }

    const rest = valid.filter((f) => !ALLOWED_VIDEO_TYPES.includes(f.type));
    if (rest.length === 0) return;

    setUploading(rest.length);
    const created: Column[] = [];
    try {
      for (const f of rest) {
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
      toast.error(await columnLimitToast("Couldn't upload one or more files. Please try again."));
    } finally {
      setUploading(0);
    }

    if (created.length > 0) {
      setColumns((prev) => [...created.reverse(), ...prev]);
      created.forEach(() => onBlockAdded());
      // Videos aren't in `created` — they toast from onComplete as each lands.
      toast.success(created.length === 1 ? "Block added." : `${created.length} blocks added.`);
    }
  };

  return { uploadFiles: handleFilesUpload, uploadPastedImages, uploading, videoUploads };
}

// Progress for the background video uploads, rendered by the board rather than
// inside the input tile: a file can be dropped on the board in either view, and
// in list view there is no tile to put the rows in.
export function ColumnUploadProgress({ uploader }: { uploader: ColumnUploader }) {
  const entries = Object.entries(uploader.videoUploads);
  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-64 flex-col gap-1">
      {entries.map(([fp, u]) => {
        const pct = u.total ? Math.min(100, Math.round((u.sent / u.total) * 100)) : 0;
        return (
          <div key={fp} className="rounded-md border bg-background/90 px-2 py-1 backdrop-blur">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{u.filename || "Video"}</span>
              {/* The failure reads as type, not as a fill, so it takes
                  --destructive-text; --destructive is picked to sit under
                  white and barely clears the background in dark mode. */}
              <span className={u.error ? "text-destructive-text" : "text-muted-foreground"}>
                {u.error ? "Failed" : `${pct}%`}
              </span>
            </div>
            {!u.error && (
              <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type ColumnInputProps = {
  user: SessionUser | null;
  columns: Column[];
  setColumns: Dispatch<SetStateAction<Column[]>>;
  channel: Channel | null;
  // Notify the parent that a block was added so it can update channel stats.
  onBlockAdded: () => void;
  // The board's upload path (see useColumnUpload). Shared with the board's own
  // drop target, so a file dropped on either lands in the same queue.
  uploader: ColumnUploader;
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
  uploader,
  onScreenshotStart,
  onScreenshotReady,
}: ColumnInputProps) {
  const [text, setText] = useState("");
  const { uploadFiles, uploadPastedImages, uploading } = uploader;
  const loading = uploading > 0;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Enter submits on a pointer-capable device only. On a phone the soft
  // keyboard's Enter has to stay a newline, or a multi-line text block can't be
  // typed here at all — the same rule the quick-add flow applies through
  // `advanceOnEnter`. Starts false so the server render and the first client
  // render agree; the effect settles it before anyone can type.
  const [submitOnEnter, setSubmitOnEnter] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: fine)");
    const sync = () => setSubmitOnEnter(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) uploadFiles(e.target.files);
    // Reset so picking the same file(s) again still fires onChange.
    e.target.value = "";
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
    // was created. A tweet URL captures its snapshot server-side here (so the
    // block is deletion-proof); if that tweet can't be fetched the action falls
    // back to a plain URL block, which the screenshot pass below then handles.
    let column: Column;
    try {
      if (isUrlInput) {
        // One server-side classifier decides what a URL becomes
        // (uploadURLColumnAction), so a link pasted here and the same link added
        // from the quick-add drawer come out as the same kind of block.
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
      toast.error(await columnLimitToast("Couldn't add that column. Please try again."));
      return;
    }

    // 2) Show the block and hand control back to the parent right away (which
    // closes the add-block modal) — the screenshot is captured afterwards.
    setColumns([column, ...columns]);
    setText("");
    onBlockAdded();

    toast.success(
      column.type === "tweet"
        ? "Tweet added."
        : column.type === "youtube"
          ? "Video added."
          : column.type === "youtube_channel"
            ? "Channel added."
            : column.type === "spotify"
              ? "Track added."
              : column.type === "github"
                ? // "owner/repo" means a repo; an account title has no slash.
                  column.title?.includes("/")
                  ? "Repo added."
                  : "Profile added."
                : column.type === "instagram"
                  ? // Read post-or-profile off the URL. The title can't tell
                    // them apart: a profile Instagram refused to serve is
                    // titled "@handle" too, from the URL alone.
                    instagramRef(column.url ?? "")?.kind === "account"
                    ? "Profile added."
                    : "Post added."
                  : column.type === "image"
                    ? "Image added."
                    : column.type === "url"
                      ? "Link added."
                      : "Column added.",
    );

    // Only plain URL blocks get the async screenshot pass. A tweet block already
    // carries its snapshot; a text block has nothing to capture; a URL that
    // pointed at an image file came back as an image block holding the bytes.
    if (column.type !== "url") return;

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

  // Files are dropped on the board, not on this tile: the tile is one grid cell
  // and isn't rendered at all in list view, so the drop target and its overlay
  // belong to the container (see channel-board). A drop landing here bubbles
  // there like any other.
  return (
    <div className="relative w-full aspect-square rounded-lg dark:bg-white/10 bg-gray-100">
      {/* Text input. text-base (16px), not text-sm — iOS Safari auto-zooms on
          focus of any input smaller than 16px. */}
      <textarea
        ref={textareaRef}
        disabled={loading}
        // Extra bottom padding once there's something to submit, so the text
        // doesn't run under the Add button sitting in that corner.
        className={`w-full h-full bg-transparent resize-none focus:outline-none p-3 leading-normal text-base ${text ? "pb-12" : ""} ${loading ? "hidden" : ""}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onPaste={handlePaste}
        placeholder=""
        onKeyDown={(e) => {
          if (submitOnEnter && e.key === "Enter" && !e.shiftKey) {
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
                accept="image/*,video/mp4,video/webm,video/quicktime,video/ogg,application/pdf,.md,.markdown,text/markdown"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </label>{" "}
            — one or many.
          </span>
        </div>
      )}

      {/* Adding is a real control, not just a key. Enter is a shortcut for it on
          a desktop and does nothing on a phone, so without this the tile has no
          visible way to post what's been typed. */}
      {text && !loading ? (
        <div className="absolute bottom-2 right-2 z-10">
          <Button size="sm" onClick={handleTextAreaUpload}>
            Add
          </Button>
        </div>
      ) : null}

      {loading && (
        <div className="absolute inset-0 flex flex-col gap-2 items-center justify-center bg-gray-100/60 dark:bg-black/50 z-10">
          <GradientSpin />
          {uploading > 1 ? (
            <p className="text-xs text-muted-foreground">{uploading} left…</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
