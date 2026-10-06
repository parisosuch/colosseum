import type { Metadata } from "next";

import CanvasPage from "@/components/canvas/canvas-page";
import { ShareProvider } from "@/components/share-context";
import ShareUnavailable from "@/components/share-unavailable";
import { threadParam } from "@/lib/canvas/route";
import { shareCoversChannel } from "@/lib/colosseum/share-link";
import { loadShare, shareOwnerHandle } from "@/lib/colosseum/share-page";

// /s/<token>/canvas: the canvas of a channel a share link opens, read-only. The
// token is the whole credential: the page and its realtime socket read as a
// signed-out visitor, whoever is signed in. A block link doesn't open it.

type ShareCanvasParams = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: "Colosseum",
  robots: { index: false, follow: false },
};

export default async function ShareCanvasPage({ params, searchParams }: ShareCanvasParams) {
  const { token } = await params;
  const share = await loadShare(token);
  if (!share || !shareCoversChannel(share, share.channel.id)) return <ShareUnavailable />;

  const { channel } = share;
  const handle = await shareOwnerHandle(channel.owned_by);

  return (
    <ShareProvider share={{ token, base: `/s/${token}` }}>
      <CanvasPage
        channel={{ id: channel.id, title: channel.title, private: channel.private }}
        handle={handle}
        channelPath={`/s/${token}`}
        canContribute={false}
        isOwner={false}
        isAdmin={false}
        viewerId={null}
        viewer={null}
        channels={[]}
        initialThreadId={threadParam((await searchParams)?.thread)}
      />
    </ShareProvider>
  );
}
