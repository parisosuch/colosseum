import { FileText } from "lucide-react";

import type { Column } from "@/lib/colosseum/column";
import { getScreenshot, type ColumnScreenshot } from "@/lib/colosseum/screenshot-data";
import {
  CARD_MEDIA_RADIUS,
  CARD_TEXT_CLASS,
  CARD_TEXT_SIZE,
  spotifyEmbedRef,
  tweetIdFromUrl,
  youtubeIdFromUrl,
} from "@/lib/utils";
import { Markdown } from "./markdown";
import ScreenShotPreview from "./screenshot-preview";
import TweetBlock from "./tweet-block-lazy";
import YouTubeBlock from "./youtube-block";
import SpotifyBlock from "./spotify-block";
import YouTubeChannelBlock from "./youtube-channel-block";
import GitHubBlock from "./github-block";
import InstagramBlock from "./instagram-block";
import VideoPoster from "./video-poster";

export default async function ColumnPreview({
  column,
  screenshot,
  priority = false,
}: {
  column: Column;
  // Pre-fetched screenshot for a url block, so a list of previews can batch the
  // lookup instead of each preview querying on its own. `undefined` means "not
  // provided — fetch it yourself"; `null` means "already looked up, none found".
  screenshot?: ColumnScreenshot | null;
  // Set by callers for the previews that can start above the fold, so their
  // images load eagerly and the rest wait until scrolled near.
  priority?: boolean;
}) {
  // return the preview based on the column type

  if (column.type === "channel") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <span className="max-w-full font-serif text-lg font-medium">
          {column.linked_channel?.title ?? "Channel"}
        </span>
        {column.linked_channel?.description ? (
          <p className="line-clamp-4 break-words text-sm text-muted-foreground">
            {column.linked_channel.description}
          </p>
        ) : null}
      </div>
    );
  }

  if (column.type === "text") {
    return (
      <div className={CARD_TEXT_CLASS}>
        <Markdown text={column.text ?? ""} className={CARD_TEXT_SIZE} />
      </div>
    );
  }

  if (column.type === "image") {
    return (
      <img
        src={`${column.image}?thumb`}
        alt={column.title ?? "Image column"}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={`w-full h-full object-cover ${CARD_MEDIA_RADIUS}`}
      />
    );
  }

  if (column.type === "pdf") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
        <FileText className="size-10" />
        <span className={`line-clamp-2 max-w-full break-words ${CARD_TEXT_SIZE}`}>
          {column.title || "PDF"}
        </span>
      </div>
    );
  }

  if (column.type === "video") {
    // The poster frame stored beside the video, as a plain image; the corner
    // marker says it's a video (the real controls live in the modal / block
    // page, which is also the only place the file itself gets fetched).
    return (
      <VideoPoster image={column.image} alt={column.title ?? "Video column"} priority={priority} />
    );
  }

  if (column.type === "tweet") {
    return <TweetBlock id={tweetIdFromUrl(column.url ?? "") ?? ""} compact />;
  }

  if (column.type === "youtube") {
    return <YouTubeBlock id={youtubeIdFromUrl(column.url ?? "") ?? ""} compact />;
  }

  if (column.type === "youtube_channel") {
    return (
      <YouTubeChannelBlock
        url={column.url ?? ""}
        title={column.title ?? "YouTube channel"}
        image={column.image}
        compact
      />
    );
  }

  if (column.type === "github") {
    return (
      <GitHubBlock
        url={column.url ?? ""}
        title={column.title ?? "GitHub"}
        image={column.image}
        compact
      />
    );
  }

  if (column.type === "instagram") {
    return (
      <InstagramBlock
        url={column.url ?? ""}
        title={column.title ?? "Instagram"}
        image={column.image}
        compact
      />
    );
  }

  if (column.type === "spotify") {
    const ref = spotifyEmbedRef(column.url ?? "");
    return <SpotifyBlock type={ref?.type ?? ""} id={ref?.id ?? ""} image={column.image} compact />;
  }

  // Use the pre-fetched screenshot when a caller passed one (batched list);
  // otherwise fetch this one on its own.
  let data: { image_url: string | null; captured_at: string | null } | null;
  if (screenshot !== undefined) {
    data = screenshot;
  } else {
    try {
      data = column.url ? await getScreenshot(column.url) : null;
    } catch {
      return (
        <div>
          <p>Error fetching the screenshot.</p>
        </div>
      );
    }
  }

  // `data` is null when no screenshot has been cached for this URL yet.
  // ScreenShotPreview handles null.
  return (
    <ScreenShotPreview
      image_url={data?.image_url ?? null}
      version={data?.captured_at ?? null}
      url={column.url}
      priority={priority}
    />
  );
}
