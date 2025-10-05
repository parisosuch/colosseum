import { getScreenshot } from "@/lib/colosseum/screenshot";

export default async function ScreenshotPreview({
  column_id,
  url,
}: {
  column_id: number;
  url: string;
}) {
  const image = await getScreenshot(column_id, url);

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {image && <img src={image} alt="Preview" className="rounded shadow" />}
    </div>
  );
}
