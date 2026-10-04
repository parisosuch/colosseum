// Turning a file or a link into a block, for the client-side paths that add
// one: the quick-add flow and the canvas's paste and drop. Each picks its own
// channel and decides what to do with the block; this is the part they share,
// so a file or a link becomes the same kind of block whichever way it came in.

import {
  getColumnQuotaAction,
  uploadImageColumnAction,
  uploadImageColumnFromUrlAction,
  uploadPdfColumnAction,
  uploadURLColumnAction,
  uploadVideoColumnAction,
} from "@/lib/colosseum/actions";
import type { Column } from "@/lib/colosseum/column";
import { columnLimitMessage } from "@/lib/quota";
import { fileBlockKind } from "@/lib/upload-limits";

export { fileBlockKind, fileProblem } from "@/lib/upload-limits";

// An image, PDF or video file as a block. The caller has already checked it
// with `fileProblem`; the server checks again.
export async function createFileBlock(channelId: number, file: File): Promise<Column> {
  const formData = new FormData();
  formData.set("channelId", String(channelId));
  formData.set("file", file);
  switch (fileBlockKind(file)) {
    case "pdf":
      return uploadPdfColumnAction(formData);
    case "video":
      return uploadVideoColumnAction(formData);
    default:
      return uploadImageColumnAction(formData);
  }
}

// A copied image's original, fetched server-side. A browser's "copy image"
// puts a flattened PNG on the clipboard, which loses a GIF's animation.
export function createImageBlockFromUrl(channelId: number, imageUrl: string): Promise<Column> {
  return uploadImageColumnFromUrlAction(channelId, imageUrl);
}

// A link as a block. uploadURLColumnAction decides what kind (tweet, YouTube,
// GitHub, an image file, a plain link). A plain link's screenshot is captured
// in the background; whoever shows the block polls for it.
export async function createUrlBlock(channelId: number, text: string): Promise<Column> {
  const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  const column = await uploadURLColumnAction({ channelId, text: url });
  if (column.type === "url") {
    void fetch("/api/screenshot", { method: "POST", body: JSON.stringify({ url }) }).catch(
      () => {},
    );
  }
  return column;
}

// Next replaces a server action's error with this in a production build.
const SANITIZED = /omitted in production builds|Server Components render/i;

// What to tell someone whose add failed. The block quota first, since a
// production build hides the server's reason; then the server's own message
// (a size limit, a missing permission) when it came through; then `fallback`.
export async function addFailureMessage(error: unknown, fallback: string): Promise<string> {
  const quota = await getColumnQuotaAction().catch(() => null);
  const limit = quota && columnLimitMessage(quota, quota.admins);
  if (limit) return limit;
  const message = error instanceof Error ? error.message.trim() : "";
  if (message && !SANITIZED.test(message)) return message;
  return fallback;
}
