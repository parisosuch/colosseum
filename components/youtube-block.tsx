import { Play } from "lucide-react";

import { CARD_BADGE_CLASS, CARD_MEDIA_RADIUS } from "@/lib/utils";

// Renders a YouTube video by id. Nothing is persisted (unlike TweetBlock) — the
// grid card shows YouTube's free thumbnail marked as a video, and the full view
// (modal / block page) embeds the live iframe player. If the video is later
// deleted the embed breaks, which is the accepted trade-off (see issue: storing
// the video would be too costly).
export default function YouTubeBlock({ id, compact = false }: { id: string; compact?: boolean }) {
  if (compact) {
    return (
      <div className="relative h-full w-full">
        <img
          src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
          alt="YouTube video"
          className={`h-full w-full object-cover ${CARD_MEDIA_RADIUS}`}
        />
        <span className={CARD_BADGE_CLASS}>
          <Play className="size-3 fill-current" />
        </span>
      </div>
    );
  }

  return (
    <div className="aspect-video w-full">
      <iframe
        src={`https://www.youtube.com/embed/${id}`}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="h-full w-full rounded-md border-0"
      />
    </div>
  );
}
