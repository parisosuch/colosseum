import { useState, useEffect } from "react";

export default function ScreenshotPreview({ url }: { url: string }) {
  // create client side supabase client

  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    const fetchScreenshot = async () => {
      try {
        const res = await fetch(
          `/api/screenshot?url=${encodeURIComponent(url)}`
        );
        const data = await res.json();
        console.log(data);
        setImage(data.image_url);
      } catch (err) {
        console.error(err);
      }
    };

    fetchScreenshot();
  }, [url]);

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {image ? <image className="w-[100px] h-[100px]" href={image} /> : null}
    </div>
  );
}
