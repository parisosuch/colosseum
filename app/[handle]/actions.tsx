"use server";

import { buildChannelCards, type ChannelCard } from "@/components/channel-card";
import { CHANNELS_PAGE } from "@/components/channel-filter";
import { getSessionUser } from "@/lib/auth";
import { getProfileChannels, viewerScope } from "@/lib/colosseum/channel";
import { getChannelColumnCounts } from "@/lib/colosseum/column";
import { getOwnerByHandle } from "@/lib/colosseum/owner";

// Next page of a profile's channel grid, already rendered as server components
// so previews and URL screenshots come out exactly as they do on first paint —
// the same trick app/explore/actions.tsx uses for the feed.
//
// `ids` says which channels the reader has scrolled to (the client owns the
// filter/sort order, so it can't be expressed as an offset). It is a hint, not
// a grant: visibility is re-derived from the session here and the ids are
// intersected with it, so asking for a private channel returns nothing.
export async function loadChannelCards(handle: string, ids: number[]): Promise<ChannelCard[]> {
  if (ids.length === 0) return [];

  // By owner, not by user: a group's profile paginates through here too.
  const [user, owner] = await Promise.all([getSessionUser(), getOwnerByHandle(handle)]);
  if (!owner) return [];

  const viewer = await viewerScope(user?.id ?? null);
  const entries = await getProfileChannels(owner.id, handle, viewer);
  const wanted = new Set(ids.slice(0, CHANNELS_PAGE));
  const slice = entries.filter((e) => wanted.has(e.channel.id));

  const counts = await getChannelColumnCounts(slice.map((e) => e.channel.id));
  return buildChannelCards(slice, viewer, counts);
}
