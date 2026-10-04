import type { Metadata } from "next";
import { redirect } from "next/navigation";

import CanvasPage from "@/components/canvas/canvas-page";
import { getSessionUser } from "@/lib/auth";
import { threadParam } from "@/lib/canvas/route";
import {
  canContributeChannel,
  canManageChannel,
  canReadChannel,
  getChannel,
  getOwnerChannels,
  resolveChannelViewer,
} from "@/lib/colosseum/channel";
import { unreadNotificationCount } from "@/lib/colosseum/notification";
import { getUserProfile } from "@/lib/colosseum/user";

type CanvasPageParams = {
  params: Promise<{ handle: string; channel_id: string }>;
  // `?thread=<id>` opens centred on that comment thread, for notification
  // links (the channel page sends them on here).
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

// The canvas has nothing a link preview could show yet, so it borrows the
// channel's title and keeps itself out of search results.
export async function generateMetadata({ params }: CanvasPageParams): Promise<Metadata> {
  const { channel_id } = await params;
  const id = parseInt(channel_id, 10);
  const channel = Number.isNaN(id) ? null : await getChannel(id);
  const title = channel && !channel.private ? `${channel.title} · canvas` : "Canvas";
  return { title, robots: { index: false } };
}

// /<handle>/<channel>/canvas. The page resolves who's looking and what they
// may do; the doc itself comes over the canvas socket once the client is up,
// and the realtime server checks access again on its own.
export default async function ChannelCanvasPage({ params, searchParams }: CanvasPageParams) {
  const { handle, channel_id } = await params;
  const initialThreadId = threadParam((await searchParams)?.thread);
  const id = parseInt(channel_id, 10);
  if (Number.isNaN(id)) redirect("/");

  const [channel, user] = await Promise.all([getChannel(id), getSessionUser()]);
  if (!channel) redirect("/");
  const viewer = await resolveChannelViewer(channel, user?.id ?? null);
  // Private channels redirect like the channel page does, without saying
  // whether they exist.
  if (!canReadChannel(channel, viewer)) redirect("/");

  const isOwner = canManageChannel(channel, viewer);
  const canContribute = canContributeChannel(channel, viewer);

  const [profile, myChannels, unread] = await Promise.all([
    user ? getUserProfile(user.id) : Promise.resolve(null),
    viewer.ownerId
      ? getOwnerChannels(viewer.ownerId).then((cs) =>
          cs.map((c) => ({ id: c.id, title: c.title, private: c.private })),
        )
      : Promise.resolve([] as { id: number; title: string; private: boolean }[]),
    user ? unreadNotificationCount(user.id) : Promise.resolve(0),
  ]);

  return (
    <CanvasPage
      channel={{ id: channel.id, title: channel.title, private: channel.private }}
      handle={handle}
      channelPath={`/${handle}/${channel.id}`}
      canContribute={canContribute}
      isOwner={isOwner}
      isAdmin={!!user?.is_admin}
      viewerId={user?.id ?? null}
      viewer={
        user && profile
          ? {
              handle: profile.handle,
              avatarUrl: profile.avatar_url ?? null,
              isAdmin: !!user.is_admin,
              unread,
            }
          : null
      }
      channels={myChannels}
      initialThreadId={initialThreadId}
    />
  );
}
