"use client";

import { useEffect, useState } from "react";

export default function ScreenShotPreview({
  image_url,
  version,
}: {
  image_url: string | null;
  // Cache-busting token (the screenshot's captured_at). The storage object is
  // overwritten in place on refresh, so without this the browser keeps serving
  // the stale cached image.
  version?: string | number | null;
}) {
  const src =
    image_url && version != null
      ? `${image_url}?v=${encodeURIComponent(String(version))}`
      : image_url;

  // A stored screenshot can 404 (deleted object, failed capture). Fall back to
  // the placeholder instead of a broken-image glyph. Reset when the src changes
  // so a refresh — or a reused instance in the virtualized list — retries.
  const [errored, setErrored] = useState(false);
  useEffect(() => setErrored(false), [src]);

  return (
    <div className="w-full h-full flex items-center justify-center">
      {src && !errored ? (
        <img
          src={src}
          alt={`Screenshot of website.`}
          onError={() => setErrored(true)}
          className="w-full h-full object-top object-cover rounded-lg"
        />
      ) : (
        <p className="px-4 text-center text-sm text-muted-foreground">Website does not exist.</p>
      )}
    </div>
  );
}
