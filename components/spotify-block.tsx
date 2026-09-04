import { Music } from "lucide-react";

import { CARD_BADGE_CLASS, CARD_MEDIA_RADIUS } from "@/lib/utils";

// Renders a Spotify item (track/album/playlist/artist/…). Nothing is persisted
// but the URL, title, and cover-art URL — the grid card shows the cover art
// marked as audio, and the full view (modal / block page) embeds the live
// iframe player. If the item is later removed the embed breaks, the accepted
// trade-off for a live embed.
export default function SpotifyBlock({
  type,
  id,
  image,
  compact = false,
}: {
  type: string;
  id: string;
  image?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="relative h-full w-full">
        {image ? (
          <img
            src={image}
            alt="Spotify cover art"
            className={`h-full w-full object-cover ${CARD_MEDIA_RADIUS}`}
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-[#1db954] ${CARD_MEDIA_RADIUS}`}
          />
        )}
        <span className={CARD_BADGE_CLASS}>
          <Music className="size-3" />
        </span>
      </div>
    );
  }

  // A track/episode is a single-item player (352px with full artwork); an
  // album/playlist/artist/show shows a scrollable tracklist that wants more room
  // than the 352px default, else only ~3 rows are visible before it scrolls.
  const listType = type !== "track" && type !== "episode";
  return (
    <iframe
      src={`https://open.spotify.com/embed/${type}/${id}`}
      title="Spotify player"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      // rounded-xl, not the rounded-md the other embeds use: Spotify draws its
      // own 12px corners inside the frame and paints white outside them, so a
      // smaller clip leaves a white wedge in each corner — invisible on a light
      // page, obvious on a dark one. Matching their radius cuts exactly where
      // their curve is. If they ever change it, this has to follow.
      className={`w-full rounded-xl border-0 ${listType ? "h-[560px]" : "h-[352px]"}`}
    />
  );
}
