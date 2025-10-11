import { memo, useState, useEffect } from "react";

export default function ScreenShotPreview({ url }: { url: string }) {
  // create client side supabase client

  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageExists, setImageExists] = useState(false);

  useEffect(() => {
    const fetchScreenshot = async () => {
      try {
        const res = await fetch(
          `/api/screenshot?url=${encodeURIComponent(url)}`
        );
        const data = await res.json();
        setImage(data.image_url);
        setLoading(false);
      } catch (err) {
        console.error(err);
      }
    };

    fetchScreenshot();
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center">
      {!loading ? (
        <img
          src={image!}
          alt={`Screenshot of ${url}`}
          className="w-full h-full object-cover rounded-lg"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center rounded-lg">
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      )}
    </div>
  );
}
