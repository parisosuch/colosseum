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

  console.log(column.url);

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

  return <ScreenShotPreview image_url={data.image_url} />;
}
