import { memo, useState, useEffect } from "react";

const ScreenShotPreview = memo(function ScreenshotPreview({
  url,
}: {
  url: string;
}) {
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
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center">
      {image ? (
        <img
          src={image}
          alt={`Screenshot of ${url}`}
          className="w-full h-full object-cover rounded-lg"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center rounded-lg">
          <p className="text-gray-500 text-sm">Loading screenshot...</p>
        </div>
      )}
    </div>
  );
});

export default ScreenShotPreview;
