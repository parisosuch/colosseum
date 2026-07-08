import type { Column } from "@/lib/colosseum/column";
import { getScreenshot } from "@/lib/colosseum/screenshot-data";
import ScreenShotPreview from "./screenshot-preview";

export default async function ColumnPreview({ column }: { column: Column }) {
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
      <div className="p-3">
        <p className="text-sm line-clamp-[10]">{column.text}</p>
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

  // get the image url of the screenshot
  let data: Awaited<ReturnType<typeof getScreenshot>>;
  try {
    data = column.url ? await getScreenshot(column.url) : null;
  } catch {
    return (
      <div>
        <p>Error fetching the screenshot.</p>
      </div>
    );
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
