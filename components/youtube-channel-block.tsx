import { Youtube } from "lucide-react";

// Renders a YouTube channel. Unlike a video, a channel has no embeddable
// player, so this is a card built from what was resolved when the block was
// added: the channel's avatar (stored in our own blob storage), its name, and
// its blurb. The grid card shows the avatar over the name; the full view adds
// the blurb and a link out to the channel.
export default function YouTubeChannelBlock({
  url,
  title,
  description,
  image,
  compact = false,
}: {
  url: string;
  title: string;
  description?: string;
  image?: string;
  compact?: boolean;
}) {
  // Fallback when the channel published no avatar, or we couldn't fetch it:
  // the channel's initial on YouTube red, so the card still reads as a channel.
  const avatar = image ? (
    <img
      src={compact ? `${image}?thumb` : image}
      alt=""
      className="aspect-square w-full rounded-full object-cover"
    />
  ) : (
    <div className="flex aspect-square w-full items-center justify-center rounded-full bg-[#ff0000] text-white">
      <Youtube className={compact ? "size-6" : "size-10"} />
    </div>
  );

  if (compact) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="w-1/2 max-w-24">{avatar}</div>
        <span className="line-clamp-2 max-w-full break-words font-serif text-lg font-medium">
          {title}
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3 p-6 text-center">
      <div className="w-32">{avatar}</div>
      <h2 className="text-heading break-words">{title}</h2>
      {description ? (
        <p className="line-clamp-6 max-w-prose break-words text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm underline underline-offset-4 hover:no-underline"
      >
        View on YouTube
      </a>
    </div>
  );
}
