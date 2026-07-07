import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ChannelBoard from "@/components/channel-board";
import { getChannel, getUserChannels } from "@/lib/colosseum/channel";
import { channelPreviewMeta } from "@/lib/colosseum/channel-meta";
import { getChannelColumnCount, getChannelColumns } from "@/lib/colosseum/column";
import { getSessionUser } from "@/lib/auth";

type ChannelPageParams = {
  params: Promise<{ handle: string; channel_id: string }>;
};

// Rich link preview for a shared channel URL. Public channels only; the helper
// returns generic metadata for private/missing ones so nothing leaks.
export async function generateMetadata({ params }: ChannelPageParams): Promise<Metadata> {
  const { handle, channel_id } = await params;
  const id = parseInt(channel_id, 10);
  const channel = Number.isNaN(id) ? null : await getChannel(id);
  return channelPreviewMeta(channel, handle);
}

export default async function ChannelPage({ params }: ChannelPageParams) {
  const { handle, channel_id } = await params;
  const id = parseInt(channel_id, 10);
  if (Number.isNaN(id)) redirect("/");

  // null = the channel doesn't exist; the visibility check below hides a private
  // channel from anyone but its owner. Don't leak which; redirect.
  const channel = await getChannel(id);
  if (!channel) redirect("/");

  const user = await getSessionUser();

  if (channel.private && (!user || user.id !== channel.owner_id)) redirect("/");

  const isOwner = !!user && channel.owner_id === user.id;

  // Cheap channel-wide stats so the shell (breadcrumb + meta) is accurate at
  // first paint. The block grid is fetched client-side with skeletons.
  const [totalCount, newest] = await Promise.all([
    getChannelColumnCount(id),
    getChannelColumns(id, { sort: "newest", limit: 1 }),
  ]);

  const createdOnLabel = new Date(channel.created_at).toLocaleString("default", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // The logged-in user's own channels back two pickers: the block modal's
  // "Move" (owner only) and "Add to channel" (any viewer can nest this channel
  // into one of theirs). Skip the query when signed out.
  const myChannels = user
    ? (await getUserChannels(user.id)).map((c) => ({
        id: c.id,
        title: c.title,
        private: c.private,
      }))
    : [];

  return (
    <ChannelBoard
      channel={channel}
      handle={handle}
      isOwner={isOwner}
      user={user}
      initialCount={totalCount}
      newestAt={newest[0]?.created_at ?? null}
      createdOnLabel={createdOnLabel}
      channels={myChannels}
    />
  );
}
