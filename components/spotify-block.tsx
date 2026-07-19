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

  // 352px is Spotify's standard embed height — a full track player with artwork,
  // or a scrollable tracklist for albums/playlists/artists.
  return (
    <iframe
      src={`https://open.spotify.com/embed/${type}/${id}`}
      title="Spotify player"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
      className="h-[352px] w-full rounded-md border-0"
    />
  );
}
