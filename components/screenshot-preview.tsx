"use client";

import { GlobeIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { screenshotSrc } from "@/lib/utils";

export default function ScreenShotPreview({
  image_url,
  version,
  url,
  priority = false,
}: {
  image_url: string | null;
  // Cache-busting token (the screenshot's captured_at) — see screenshotSrc.
  version?: string | number | null;
  // The block's URL, shown as the fallback when no screenshot could be captured
  // — the site may still resolve, so the block stays identifiable and usable.
  url?: string | null;
  // Set for the handful of cards that start above the fold. Those load eagerly
  // because deferring the one the viewer is looking at is what LCP measures;
  // everything below it waits until it's scrolled near.
  priority?: boolean;
}) {
  const src = screenshotSrc(image_url, version);

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
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="w-full h-full object-top object-cover rounded-lg"
        />
      ) : url ? (
        // Same treatment as the modal's empty state, scaled down: the mark
        // above the address makes the cell read as a link rather than as a
        // block whose picture failed to load.
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <GlobeIcon className="size-6 text-muted-foreground" />
          <p className="font-mono text-sm text-muted-foreground line-clamp-3 break-all">
            {url.replace(/^https?:\/\//, "")}
          </p>
        </div>
      ) : (
        <p className="px-4 text-center text-sm text-muted-foreground">Website does not exist.</p>
      )}
    </div>
  );
}
