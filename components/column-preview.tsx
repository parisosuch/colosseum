import { Column } from "@/lib/colosseum/column";
import { createClient } from "@/lib/supabase/server";
import ScreenShotPreview from "./screenshot-preview";

export default async function ColumnPreview({ column }: { column: Column }) {
  // return the preview based on the column type

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
        src={column.image}
        alt={column.title ?? "Image block"}
        className="w-full h-full object-cover rounded-md"
      />
    );
  }

  // get the image url of the screenshot
  const supabase = await createClient();

  const { data, error: selectError } = await supabase
    .from("screenshot")
    .select("*")
    .eq("url", column.url)
    .maybeSingle();

  if (selectError) {
    return (
      <div>
        <p>Error fetching the screenshot.</p>
      </div>
    );
  }

  // `data` is null when no screenshot has been cached for this URL yet
  // (maybeSingle returns null, not an error). ScreenShotPreview handles null.
  return (
    <ScreenShotPreview
      image_url={data?.image_url ?? null}
      version={data?.captured_at ?? null}
      title={data?.title ?? column.title ?? null}
    />
  );
}
