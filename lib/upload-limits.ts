// The upload limits the browser checks before sending a file, so an oversized
// or unsupported one gets a clear message instead of an opaque server-action
// body error. Copies of the server's limits in lib/colosseum/blob.ts, which is
// server-only; keep the two in step.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
];
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];
export const PDF_TYPE = "application/pdf";

export type FileBlockKind = "image" | "pdf" | "video";

// What kind of block a file makes, or null when it can't be one.
export function fileBlockKind(file: { type: string }): FileBlockKind | null {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return "image";
  if (file.type === PDF_TYPE) return "pdf";
  if (ALLOWED_VIDEO_TYPES.includes(file.type)) return "video";
  return null;
}

// Why a file can't be uploaded, or null when it can.
export function fileProblem(file: { type: string; size: number }): string | null {
  const kind = fileBlockKind(file);
  if (!kind) return "That's not an image, video, or PDF.";
  const [cap, label] =
    kind === "video"
      ? [MAX_VIDEO_BYTES, "100MB"]
      : kind === "pdf"
        ? [MAX_PDF_BYTES, "25MB"]
        : [MAX_IMAGE_BYTES, "10MB"];
  return file.size > cap ? `That file is too large (max ${label}).` : null;
}
