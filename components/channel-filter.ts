// Pure channel-list search, split out from the (client) ChannelsView so it can
// be unit-tested without pulling in the React/next component tree.

export type ChannelRow = {
  id: number;
  title: string;
  description?: string;
  private: boolean;
  created_at: string;
  count: number;
  // Set for channels the profile owner is a member of (not owner): `handle` is
  // the owning user's handle for the link, `memberOf` flags the "Member of" badge.
  handle?: string;
  memberOf?: boolean;
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
