import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ChannelBoard, { PAGE_SIZE } from "@/components/channel-board";
import {
  canContributeChannel,
  canReadChannel,
  getChannel,
  getUserChannels,
} from "@/lib/colosseum/channel";
import { isChannelMember, listChannelMembers } from "@/lib/colosseum/member";
import { getPublicUserProfile } from "@/lib/colosseum/user";
import { channelPreviewMeta } from "@/lib/colosseum/channel-meta";
import { getChannelColumnCount, getChannelColumns } from "@/lib/colosseum/column";
import { getScreenshotsForUrls } from "@/lib/colosseum/screenshot-data";
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

  // Membership matters for reading a private channel and for adding to a public
  // or private one; open channels never gate on it. Resolve it once for both the
  // read gate and canContribute below.
  const isMember =
    channel.access !== "open" && user ? await isChannelMember(channel.id, user.id) : false;
  // Private channels are visible only to the owner or a member; hide the rest
  // (redirect, don't leak existence). Public/open are visible to all.
  if (!canReadChannel(channel, user?.id ?? null, isMember)) redirect("/");

  const isOwner = !!user && channel.owner_id === user.id;
  const canContribute = canContributeChannel(channel, user?.id ?? null, isMember);

  // Server-render the first page of blocks (plus channel-wide count for the
  // meta panel) so the grid paints at first load instead of after a hydrate +
  // server-action round-trip. The client takes over for filtering/paging.
  const [totalCount, initialColumns] = await Promise.all([
    getChannelColumnCount(id),
    getChannelColumns(id, { sort: "newest", limit: PAGE_SIZE }, user?.id ?? null),
  ]);

  // Cached previews for the first page's URL blocks, so screenshots render at
  // first paint too. URLs without a cached row are simply absent; the board's
  // hydrate/poll effect fetches those.
  const initialScreenshots = [
    ...(
      await getScreenshotsForUrls(
        initialColumns.filter((c) => c.type === "url" && c.url).map((c) => c.url!),
      )
    ).entries(),
  ];

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

  // Collaborators shown on the board itself (not just settings). Only public and
  // private channels have a roster; open channels let anyone add. Skip the
  // owner-avatar lookup when there are no members to show.
  const members = channel.access !== "open" ? await listChannelMembers(id) : [];
  const ownerAvatarUrl =
    members.length > 0 ? ((await getPublicUserProfile(handle))?.avatar_url ?? null) : null;

  return (
    <ChannelBoard
      channel={channel}
      handle={handle}
      isOwner={isOwner}
      canContribute={canContribute}
      user={user}
      initialCount={totalCount}
      newestAt={initialColumns[0]?.created_at ?? null}
      createdOnLabel={createdOnLabel}
      channels={myChannels}
      members={members}
      ownerAvatarUrl={ownerAvatarUrl}
      initialColumns={initialColumns}
      initialScreenshots={initialScreenshots}
    />
  );
}
