import { FileText } from "lucide-react";

import type { Column } from "@/lib/colosseum/column";
import { getScreenshot, type ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import { Markdown } from "./markdown";
import ScreenShotPreview from "./screenshot-preview";

export default async function ColumnPreview({
  column,
  screenshot,
}: {
  column: Column;
  // Pre-fetched screenshot for a url block, so a list of previews can batch the
  // lookup instead of each preview querying on its own. `undefined` means "not
  // provided — fetch it yourself"; `null` means "already looked up, none found".
  screenshot?: ColumnScreenshot | null;
}) {
  // return the preview based on the column type

  if (column.type === "channel") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="max-w-full font-serif text-lg font-medium">
          {column.linked_channel?.title ?? "Channel"}
        </span>
        {column.linked_channel?.description ? (
          <p className="line-clamp-4 break-words text-sm text-muted-foreground">
            {column.linked_channel.description}
          </p>
        ) : null}
      </div>
    );
  }

  if (column.type === "text") {
    return (
      <div className="h-full w-full overflow-hidden p-3">
        <Markdown text={column.text ?? ""} />
      </div>
    );
  }

  if (column.type === "image") {
    return (
      <img
        src={`${column.image}?thumb`}
        alt={column.title ?? "Image column"}
        className="w-full h-full object-cover rounded-md"
      />
    );
  }

  if (column.type === "pdf") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
        <FileText className="size-10" />
        <span className="line-clamp-2 max-w-full break-words text-sm">{column.title || "PDF"}</span>
      </div>
    );
  }

  // Use the pre-fetched screenshot when a caller passed one (batched list);
  // otherwise fetch this one on its own.
  let data: { image_url: string | null; captured_at: string | null } | null;
  if (screenshot !== undefined) {
    data = screenshot;
  } else {
    try {
      data = column.url ? await getScreenshot(column.url) : null;
    } catch {
      return (
        <div>
          <p>Error fetching the screenshot.</p>
        </div>
      );
    }
  }

  // `data` is null when no screenshot has been cached for this URL yet.
  // ScreenShotPreview handles null.
  return (
    <ScreenShotPreview
      image_url={data?.image_url ?? null}
      version={data?.captured_at ?? null}
      url={column.url}
    />
  );
}
