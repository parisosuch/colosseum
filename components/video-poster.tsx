"use client";

import { useState } from "react";
import { Play } from "lucide-react";

import { CARD_BADGE_CLASS, CARD_MEDIA_RADIUS, thumbSrc } from "@/lib/utils";

// A video block's card art: the poster frame decoded at upload time, served as
// a small webp by the same `?thumb` that backs image cards. No <video> element
// is involved, so a row of video cards costs one lazily-loaded image each
// instead of a ranged read of every file on the page — the real player lives in
// the modal and on the block page, which is where it gets loaded.
//
// Client-side only for the error path: a block uploaded on a deployment with no
// ffmpeg has no poster and `?thumb` 404s, and the card has to stay a card. Both
// the grid card and the server-rendered preview render this, so the fallback is
// the same shape in either.
export default function VideoPoster({
  image,
  alt,
  priority = false,
  className = CARD_MEDIA_RADIUS,
  iconClassName = "size-3",
}: {
  // Media URL of the video blob (the block's `image` field).
  image: string | null | undefined;
  alt: string;
  // Set for the cards that can start above the fold; the rest wait until
  // they're scrolled near, matching how image cards load.
  priority?: boolean;
  // Corner radius (and anything else) for the media box. Both renderers take
  // the shared default; a caller only passes this to add something to it.
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = thumbSrc(image);

  return (
    <div className="relative h-full w-full">
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover ${className}`}
        />
      ) : (
        <div className={`h-full w-full bg-muted ${className}`} />
      )}
      <span className={CARD_BADGE_CLASS}>
        <Play className={`${iconClassName} fill-current`} />
      </span>
    </div>
  );
}
