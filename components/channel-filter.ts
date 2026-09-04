// Pure channel-list search / filter / sort, split out from the (client)
// ChannelsView so it can be unit-tested without pulling in the React/next
// component tree. Mirrors the string union in lib/colosseum/channel.ts, which
// is server-only and can't be imported here.

export type ChannelAccess = "public" | "open" | "private";

// Channel cards rendered per page on a profile. The server renders the first
// page; the client asks for the next as the reader scrolls. Lives here, in a
// module that is neither "use client" nor server-only, for the same reason
// lib/pagination.ts does: a const exported from a "use client" file reaches a
// Server Component as a client reference, not the number.
export const CHANNELS_PAGE = 12;

export type ChannelRow = {
  id: number;
  title: string;
  description?: string;
  access: ChannelAccess;
  private: boolean;
  created_at: string;
  count: number;
  // Set for channels the profile owner is a member of (not owner): `handle` is
  // the owning user's handle for the link, `memberOf` flags the "Member of" badge.
  handle?: string;
  memberOf?: boolean;
};

export type ChannelSort = "recent" | "name" | "count";

export type ChannelFilters = {
  search: string;
  // Access modes to include; empty means "all".
  access: ChannelAccess[];
  // When true, keep only channels the viewer is a member of (not owner).
  memberOf: boolean;
};

// Case-insensitive match of a channel against a search query, by title or
// description. An empty query matches everything.
export function channelMatches(channel: ChannelRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    channel.title.toLowerCase().includes(q) || (channel.description ?? "").toLowerCase().includes(q)
  );
}

// Apply search + access + member-of filters, then sort. The input order is the
// server's "recently added to" order (desc), which the "recent" sort preserves.
// Array.sort is stable, so ties in name/count keep that recent ordering.
export function filterSortChannels(
  channels: ChannelRow[],
  filters: ChannelFilters,
  sort: ChannelSort,
): ChannelRow[] {
  const filtered = channels.filter(
    (c) =>
      channelMatches(c, filters.search) &&
      (filters.access.length === 0 || filters.access.includes(c.access)) &&
      (!filters.memberOf || !!c.memberOf),
  );
  if (sort === "name") {
    return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
  }
  if (sort === "count") {
    return [...filtered].sort((a, b) => b.count - a.count);
  }
  return filtered;
}
