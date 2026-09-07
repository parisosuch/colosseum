import "server-only";

import { getSessionUser } from "@/lib/auth";
import { Channel, canReadChannel, getChannel, resolveChannelViewer, SIGNED_OUT } from "./channel";
import { Column, getColumn } from "./column";

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
  // Only a private channel's read depends on who is asking, so the session and
  // the owner/member lookups behind it stay off the public path entirely.
  if (channel.access === "private") {
    const user = await getSessionUser();
    if (!canReadChannel(channel, await resolveChannelViewer(channel, user?.id ?? null))) {
      return null;
    }
  } else if (!canReadChannel(channel, { ...SIGNED_OUT, isChannelMember: false })) {
    return null;
  }
  return { column, channel };
}
