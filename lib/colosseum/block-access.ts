import "server-only";

import { getSessionUser } from "@/lib/auth";
import { Channel, canReadChannel, getChannel } from "./channel";
import { Column, getColumn } from "./column";
import { isChannelMember } from "./member";

// Resolve a block and its channel, enforcing visibility in app code (this
// connection bypasses RLS): a block is visible only when it belongs to the
// channel in the URL and that channel is readable by the viewer. Returns null
// for any not-found/hidden case so a private block is never leaked — not even
// its title, via metadata. A private channel is visible to its owner or an
// invited member; public/open channels to anyone.
//
// Shared by the standalone block page and the channel board's `?block=` deep
// link, so both gate on exactly the same rule.
export async function loadVisibleBlock(
  channelId: number,
  blockId: number,
): Promise<{ column: Column; channel: Channel } | null> {
  if (Number.isNaN(channelId) || Number.isNaN(blockId)) {
    return null;
  }
  const column = await getColumn(blockId);
  if (!column || column.channel_id !== channelId) {
    return null;
  }
  const channel = await getChannel(channelId);
  if (!channel) {
    return null;
  }
  const user = channel.access === "private" ? await getSessionUser() : null;
  const isMember =
    channel.access === "private" && user ? await isChannelMember(channel.id, user.id) : false;
  if (!canReadChannel(channel, user?.id ?? null, isMember)) {
    return null;
  }
  return { column, channel };
}
