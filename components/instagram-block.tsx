import { Instagram } from "lucide-react";

import { Button } from "@/components/ui/button";
import { instagramRef } from "@/lib/utils";

// Renders an Instagram post, reel, or account. Instagram shows a logged-out
// visitor a login wall, so a screenshot would capture that rather than the
// post — the card is built from the preview metadata resolved when the block
// was added, with the picture stored in our own blob storage (Instagram's CDN
// URLs are signed and expire).
//
// A post is its picture, so the card is the picture, full-bleed, like an image
// block. A reel shows its cover frame: the video itself isn't persisted, same
// as a YouTube block. An account has no picture of its own to show, so it gets
// the avatar card the YouTube channel and GitHub blocks share.
export default function InstagramBlock({
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
  // Post or account is a property of the canonical URL, so nothing had to be
  // stored to tell them apart.
  const account = instagramRef(url)?.kind === "account";

  // No picture means the lookup was blocked (Instagram rate-limits whole IP
  // ranges) — fall through to the card below, which draws the Instagram mark in
  // place of an avatar. A post with no picture has nothing to be full-bleed.
  if (!account && image) {
    if (compact) {
      return (
        <img
          src={image ? `${image}?thumb` : undefined}
          alt={title}
          loading="lazy"
          decoding="async"
          className="h-full w-full rounded-lg object-cover"
        />
      );
    }
    return (
      <figure className="flex w-full flex-col items-center gap-3">
        {/* The picture is the link. A post's whole subject is its picture — and
            a reel's cover carries Instagram's own play badge, which reads as
            something you click — so clicking it opens the post rather than
            sending the reader hunting for a button. That makes a separate "View
            on Instagram" a second control for the one action, so there isn't
            one here (the account card below keeps its button: an avatar beside
            a name doesn't read as a link the way a photo does). */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-full transition-opacity hover:opacity-90"
        >
          <img
            src={image}
            alt={title}
            className="max-h-[70vh] max-w-full rounded-md object-contain"
          />
        </a>
        {description ? (
          // The caption keeps its line breaks — an Instagram caption is written
          // with them, and collapsing them runs the whole thing together.
          <figcaption className="line-clamp-6 max-w-prose whitespace-pre-line break-words text-sm text-muted-foreground">
            {description}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  // Fallback when there's no picture to show — the avatar couldn't be stored, or
  // Instagram refused the lookup entirely: the Instagram mark filling the
  // circle, so the card still has a subject.
  const avatar = image ? (
    <img
      src={compact ? `${image}?thumb` : image}
      alt=""
      className="aspect-square w-full rounded-full object-cover"
    />
  ) : (
    <div className="flex aspect-square w-full items-center justify-center rounded-full bg-foreground text-background">
      <Instagram className={compact ? "size-6" : "size-10"} />
    </div>
  );

  // The mark sits with the name, matching the GitHub and YouTube channel cards:
  // it says what kind of block this is, which belongs next to the thing being
  // named. Inline rather than a flex child so a name wrapping to a second line
  // leaves it beside the first character.
  const name = (size: string) => (
    <>
      <Instagram className={`mr-2 inline align-middle ${size}`} />
      {title}
    </>
  );

  if (compact) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="w-1/2 max-w-24">{avatar}</div>
        <span className="line-clamp-2 min-h-14 max-w-full break-words text-heading">
          {name("size-4")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3 p-6 text-center">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-32 transition-opacity hover:opacity-90"
      >
        {avatar}
      </a>
      <h2 className="text-heading break-words">{name("size-4")}</h2>
      {description ? (
        <p className="line-clamp-6 max-w-prose whitespace-pre-line break-words text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      <Button asChild variant="link" size="sm">
        <a href={url} target="_blank" rel="noopener noreferrer">
          View on Instagram
        </a>
      </Button>
    </div>
  );
}
