import { memo, useState, useEffect } from "react";

export default function ScreenShotPreview({ url }: { url: string }) {
  // create client side supabase client

  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageExists, setImageExists] = useState(true);

  useEffect(() => {
    const fetchScreenshot = async () => {
      try {
        const res = await fetch(
          `/api/screenshot?url=${encodeURIComponent(url)}`
        );
        if (res.status === 404) {
          setImageExists(false);
        } else {
          const data = await res.json();
          setImage(data.image_url);
        }
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };

    fetchScreenshot();
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center">
      {!loading ? (
        imageExists ? (
          <img
            src={image!}
            alt={`Screenshot of ${url}`}
            className="w-full h-full object-cover rounded-lg"
          />
        ) : (
          <p>Website does not exist.</p>
        )
      ) : (
        <div className="w-full h-full flex items-center justify-center rounded-lg">
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      )}
    </div>
  );
}
