"use client";

import { EmbeddedTweet, TweetNotFound, TweetSkeleton, useTweet } from "react-tweet";
import "react-tweet/theme.css";

// Renders a persisted tweet from our own snapshot (served by /api/tweet/[id]),
// not from X — so it looks the same after the original is deleted. Used both in
// the grid card (compact: clipped to the square, non-interactive) and the block
// modal (full: scrollable).

export default function TweetBlock({ id, compact = false }: { id: string; compact?: boolean }) {
  const { data, error, isLoading } = useTweet(id, `/api/tweet/${id}`);

  const inner =
    isLoading && !data ? (
      <TweetSkeleton />
    ) : error || !data ? (
      <TweetNotFound />
    ) : (
      <EmbeddedTweet tweet={data} />
    );

  if (compact) {
    // Fill the square card and clip the overflow; the tweet's own margin is
    // zeroed so it starts flush at the top. pointer-events-none — the whole card
    // is the click target that opens the modal.
    return (
      <div
        className="pointer-events-none h-full w-full overflow-hidden [&_.react-tweet-theme]:m-0"
        style={{ ["--tweet-container-margin" as string]: "0" }}
      >
        {inner}
      </div>
    );
  }

  return <div className="[&_.react-tweet-theme]:my-0">{inner}</div>;
}
