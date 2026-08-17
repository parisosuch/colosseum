"use client";

import dynamic from "next/dynamic";

// react-tweet (and its theme CSS) is ~13 kB of the client bundle that used to
// load on the channel, profile and explore pages whether or not a tweet block
// existed — which, for most channels, it doesn't. This wrapper defers the whole
// module until something actually renders a tweet.
//
// Every tweet call site goes through here — the grid card, the server-rendered
// preview cards, and the modal — rather than some importing ./tweet-block
// directly. One import specifier means webpack instantiates react-tweet once,
// so useTweet's SWR cache is a single shared map: a card that has already
// fetched /api/tweet/<id> hands the modal the same cache entry, and the
// transition still paints immediately. Introducing a second path (or wrapping
// this in its own SWRConfig) would split that cache and reintroduce the fetch.
//
// The theme CSS is imported inside ./tweet-block, so it travels in the same
// chunk: webpack resolves the chunk only after its stylesheet has loaded, and
// the card paints styled rather than flashing bare.
//
// ssr: false costs nothing here — useTweet has no data on the server, so the
// server pass already rendered react-tweet's skeleton.
const TweetBlock = dynamic(() => import("./tweet-block"), {
  ssr: false,
  // Neutral filler at the size of the eventual embed. TweetSkeleton would be
  // the natural placeholder but it lives in the chunk being deferred.
  loading: () => <div className="h-full w-full animate-pulse rounded-md bg-muted" />,
});

export default function TweetBlockLazy({ id, compact = false }: { id: string; compact?: boolean }) {
  return <TweetBlock id={id} compact={compact} />;
}
