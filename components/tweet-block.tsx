"use client";

import { useMemo } from "react";
import { EmbeddedTweet, TweetNotFound, TweetSkeleton, useTweet } from "react-tweet";
import type { Tweet } from "react-tweet/api";
import "react-tweet/theme.css";

// Renders a persisted tweet from our own snapshot (served by /api/tweet/[id]),
// not from X — so it looks the same after the original is deleted. Used both in
// the grid card (compact: clipped to the square, non-interactive) and the block
// modal (full: scrollable).

// Snapshots store self-hosted media as root-relative `/api/media/<id>` URLs so
// they aren't pinned to one origin. react-tweet's getMediaUrl does `new URL(src)`,
// which throws on a relative URL, so we make them absolute — against the
// *browser's* origin, the only authoritative one. A server-derived origin
// (req.nextUrl.origin) behind a TLS-terminating proxy is http:// or an internal
// host, so those URLs get blocked as mixed content or point nowhere and every
// image — the avatar included — fails to load.
function withAbsoluteMedia(tweet: Tweet): Tweet {
  if (typeof window === "undefined") return tweet;
  const origin = window.location.origin;
  const abs = (url: string) => (url.startsWith("/api/media/") ? `${origin}${url}` : url);
  const clone = structuredClone(tweet);
  const walk = (t: Tweet) => {
    t.user.profile_image_url_https = abs(t.user.profile_image_url_https);
    for (const media of t.mediaDetails ?? []) media.media_url_https = abs(media.media_url_https);
    if (t.quoted_tweet) walk(t.quoted_tweet as unknown as Tweet);
  };
  walk(clone);
  return clone;
}

export default function TweetBlock({ id, compact = false }: { id: string; compact?: boolean }) {
  const { data, error, isLoading } = useTweet(id, `/api/tweet/${id}`);
  const tweet = useMemo(() => (data ? withAbsoluteMedia(data) : data), [data]);

  const inner =
    isLoading && !data ? (
      <TweetSkeleton />
    ) : error || !tweet ? (
      <TweetNotFound />
    ) : (
      <EmbeddedTweet tweet={tweet} />
    );

  if (compact) {
    // Fill the square card and clip the overflow; the tweet's own margin is
    // zeroed so it starts flush at the top. pointer-events-none — the whole card
    // is the click target that opens the modal.
    return (
      <div
        className="pointer-events-none h-full w-full overflow-hidden [&_.react-tweet-theme]:m-0 [&_.react-tweet-theme]:[--tweet-body-font-size:0.8125rem] [&_.react-tweet-theme]:[--tweet-body-line-height:1.1rem] [&_.react-tweet-theme]:[--tweet-header-font-size:0.8125rem] [&_.react-tweet-theme]:[--tweet-header-line-height:1rem] [&_.react-tweet-theme]:[--tweet-info-font-size:0.75rem] [&_[class*='videoButton']]:hidden [&_[class*='watchOnTwitter']]:hidden"
        style={{ ["--tweet-container-margin" as string]: "0" }}
      >
        {inner}
      </div>
    );
  }

  return <div className="[&_.react-tweet-theme]:my-0">{inner}</div>;
}
