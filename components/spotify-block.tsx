import { Music } from "lucide-react";

// Renders a Spotify item (track/album/playlist/artist/…). Nothing is persisted
// but the URL, title, and cover-art URL — the grid card shows the cover art
// with a music badge, and the full view (modal / block page) embeds the live
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
            className="h-full w-full rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-lg bg-[#1db954]" />
        )}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/50 p-2 text-white">
            <Music className="size-4" />
          </span>
        </div>
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
      className={`w-full rounded-md border-0 ${listType ? "h-[560px]" : "h-[352px]"}`}
    />
  );
}
