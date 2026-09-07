import { cache } from "react";

import { and, desc, eq, ilike, inArray, ne, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { cached, cacheKeys, cacheTtl, invalidate } from "@/lib/cache";
import { channel, channelMember, column, owner } from "@/lib/db/schema";
import { sanitizeSearch } from "@/lib/utils";
import { deleteMediaByUrl, mediaUrl, setMediaVisibilityByUrls } from "./blob";
import { deleteScreenshotIfUnreferenced } from "./column";
import { roleCanManage } from "./group";
import { isChannelMember } from "./member";
import { SIGNED_OUT, viewerOwnerIds, viewerRoleFor, viewerScope, type ViewerScope } from "./viewer";

export { SIGNED_OUT, viewerOwnerIds, viewerRoleFor, viewerScope, type ViewerScope };

// A channel's access mode. `public`: everyone reads, only the owner adds.
// `open`: everyone reads, any signed-in user adds. `private`: only the owner and
// channel_member rows read or add.
export type ChannelAccess = "public" | "open" | "private";

export type Channel = {
  id: number;
  created_at: string;
  title: string;
  description?: string;
  access: ChannelAccess;
  // ponytail: derived display shim (access === "private"). `access` is the
  // source of truth; this keeps read-only "is it hidden?" call sites unchanged.
  private: boolean;
  // The `owner` row that owns this channel, never a user id. The two are
  // different values for the same person, so comparing this against a session's
  // user id is always false and always a bug — resolve a ViewerScope instead.
  owned_by: string;
  updated_at?: string;
  tags: string[];
};

// A viewer resolved against one specific channel: their scope plus whether they
// hold a channel_member row for it. The predicates below take this rather than a
// bare user id so that adding another way to be authorized (a group role)
// changes one resolver instead of every call site.
export type ChannelViewer = ViewerScope & { isChannelMember: boolean };

export async function resolveChannelViewer(
  ch: Channel,
  userId: string | null,
): Promise<ChannelViewer> {
  const scope = await viewerScope(userId);
  // Open channels never gate on membership, so don't pay for the lookup.
  const isMember = ch.access !== "open" && userId ? await isChannelMember(ch.id, userId) : false;
  return { ...scope, isChannelMember: isMember };
}

// SQL predicate: does `user_id` have a channel_member row for `channel.id`?
// Signed-out viewers (null) never match.
function isMemberSql(user_id: string | null) {
  if (!user_id) return sql`false`;
  return sql`exists (select 1 from ${channelMember} where ${channelMember.channel_id} = ${channel.id} and ${channelMember.user_id} = ${user_id})`;
}

// SQL predicate: is this channel visible to `viewer`? The same three branches
// canReadChannel uses — not private, owned by someone the viewer acts for, or
// the viewer holds a member row — kept here so the list queries and the row
// predicate can't drift.
//
// The middle branch is where a group's private channels come from: a member's
// owner ids include every group they are in, so nothing group-specific is
// needed here or in any of the five queries that call this.
function isVisibleSql(viewer: ViewerScope) {
  const ownerIds = viewerOwnerIds(viewer);
  return or(
    ne(channel.access, "private"),
    ownerIds.length > 0 ? inArray(channel.owned_by, ownerIds) : undefined,
    isMemberSql(viewer.userId),
  );
}

// ---------------------------------------------------------------------------
// Access predicates — the single source of the authorization matrix. Callers
// resolve a ChannelViewer (above) and pass it in; public/open reads ignore it.
//
// Each one asks the viewer's role in the channel's *owner*. For a personal
// channel that role is "owner" and the group tiers never come up; for a group's
// channel it is whatever the roster says, which is what makes an admin able to
// manage a channel they did not create and a member able only to add to it.
// ---------------------------------------------------------------------------

// Read: public/open are visible to anyone; private only to someone who acts for
// the owner (its author, or any member of the owning group) or holds a
// per-channel member row.
export function canReadChannel(ch: Channel, viewer: ChannelViewer): boolean {
  if (ch.access !== "private") return true;
  return !!viewerRoleFor(viewer, ch.owned_by) || viewer.isChannelMember;
}

// Which of these users may read the channel, order preserved and duplicates
// kept. Only private channels cost a membership lookup. Callers that fan out to
// a set of recipients (notifications) use this so the read rule stays defined
// where the rest of the matrix is.
export async function channelReaders(ch: Channel, userIds: string[]): Promise<string[]> {
  if (ch.access !== "private") return userIds;
  const readable = await Promise.all(
    userIds.map(async (id) => canReadChannel(ch, await resolveChannelViewer(ch, id))),
  );
  return userIds.filter((_, i) => readable[i]);
}

// Add blocks: open → any signed-in user; public and private → anyone who acts
// for the owner (including a group's `member` tier) or an invited member. (A
// public channel with no members is therefore owner-only; add members to make it
// a publicly-readable, members-only-writable channel.)
export function canContributeChannel(ch: Channel, viewer: ChannelViewer): boolean {
  if (!viewer.userId) return false;
  if (ch.access === "open") return true;
  return !!viewerRoleFor(viewer, ch.owned_by) || viewer.isChannelMember;
}

// Manage (settings, delete, members): the owner, whatever the access mode. For a
// group's channel that means its owner and admins — a `member` may add blocks
// but not rename or delete the channel they were added to, which is the one
// place the roles differ from plain membership.
export function canManageChannel(ch: Channel, viewer: ViewerScope): boolean {
  return roleCanManage(viewerRoleFor(viewer, ch.owned_by));
}

// May this user view the bytes behind a media id? True when they can read any
// channel that embeds it (a column's image points at /api/media/<id>). The
// media route calls this instead of re-checking media ownership, so the
// owner-or-member read rule stays defined in exactly one place — a private
// channel's members must see its images, not just its owner.
export async function canReadMedia(mediaId: string, userId: string | null): Promise<boolean> {
  const rows = await db
    .select({ channel_id: column.channel_id })
    .from(column)
    .where(eq(column.image, mediaUrl(mediaId)));
  const channelIds = [...new Set(rows.map((r) => r.channel_id))];
  for (const id of channelIds) {
    const ch = await getChannel(id);
    if (!ch) continue;
    if (canReadChannel(ch, await resolveChannelViewer(ch, userId))) return true;
  }
  return false;
}

// Drizzle returns Date objects for timestamptz and null for absent columns; the
// app's Channel type uses ISO strings and optional fields. Normalize on the way
// out so callers keep the shape they had under the Supabase client.
type ChannelRow = typeof channel.$inferSelect;
function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    title: row.title,
    description: row.description ?? undefined,
    access: row.access,
    private: row.access === "private",
    owned_by: row.owned_by,
    updated_at: row.updated_at?.toISOString() ?? undefined,
    tags: row.tags,
  };
}

// Order channels by their most recently added block, so a channel bubbles up
// when the owner drops something new in it. Channels with no blocks yet fall
// back to their own creation time.
const lastBlockAddedAt = sql`coalesce((select max(${column.created_at}) from ${column} where ${column.channel_id} = ${channel.id}), ${channel.created_at})`;

export async function getOwnerPublicChannels(owner_id: string): Promise<Channel[]> {
  return cached(cacheKeys.ownerPublicChannels(owner_id), cacheTtl.ownerChannels, async () => {
    const rows = await db
      .select()
      .from(channel)
      .where(and(eq(channel.owned_by, owner_id), ne(channel.access, "private")))
      .orderBy(desc(lastBlockAddedAt));
    return rows.map(toChannel);
  });
}

// Wrapped in React cache() so one render shares a single lookup. A channel page
// asks for this three times over — the nav bar, the mobile bottom nav, and the
// page's own Move/Connect pickers — all for the same viewer. The Redis layer
// below spans requests when REDIS_URL is set, but it's off by default and a hit
// is still a round trip; cache() keys on the owner id and dedupes within the
// request. Safe to memoize because every caller is a read on the render path:
// the mutations that change this list invalidate through
// invalidateOwnerChannelLists and re-read in a later request.
export const getOwnerChannels = cache(async (owner_id: string): Promise<Channel[]> => {
  return cached(cacheKeys.ownerChannels(owner_id), cacheTtl.ownerChannels, async () => {
    const rows = await db
      .select()
      .from(channel)
      .where(eq(channel.owned_by, owner_id))
      .orderBy(desc(lastBlockAddedAt));
    return rows.map(toChannel);
  });
});

// Invalidate the per-owner channel-list caches. Called whenever a channel that
// owner holds is created, updated, or deleted.
async function invalidateOwnerChannelLists(owner_id: string): Promise<void> {
  await invalidate(cacheKeys.ownerPublicChannels(owner_id), cacheKeys.ownerChannels(owner_id));
}

// Channels the viewer is an explicit member of (never ones they own — the owner
// is an implicit member with no row). Joined to the owner's handle so the
// profile can link each to /handle/id. Newest activity first.
export async function getMemberChannels(
  viewer: ViewerScope,
): Promise<(Channel & { handle: string })[]> {
  if (!viewer.userId) return [];
  const ownerIds = viewerOwnerIds(viewer);
  const rows = await db
    .select({ ch: channel, handle: owner.handle })
    .from(channelMember)
    .innerJoin(channel, eq(channel.id, channelMember.channel_id))
    .innerJoin(owner, eq(owner.id, channel.owned_by))
    .where(
      and(
        eq(channelMember.user_id, viewer.userId),
        // Never a channel the viewer already reaches as its owner — their own,
        // or one belonging to a group they are in. Those are not "invited to".
        ownerIds.length > 0 ? notInArray(channel.owned_by, ownerIds) : undefined,
      ),
    )
    .orderBy(desc(lastBlockAddedAt));
  return rows.map(({ ch, handle }) => ({ ...toChannel(ch), handle }));
}

// The owner's channels as visible to `viewer`: every public/open one, plus
// private ones the viewer owns or is a member of. Backs the profile grid so an
// invited member sees the private group channels they belong to.
export async function getVisibleOwnerChannels(
  owner_id: string,
  viewer: ViewerScope,
): Promise<Channel[]> {
  const rows = await db
    .select()
    .from(channel)
    .where(and(eq(channel.owned_by, owner_id), isVisibleSql(viewer)))
    .orderBy(desc(lastBlockAddedAt));
  return rows.map(toChannel);
}

// One card in a profile's channel grid: the channel, the handle its
// `/{handle}/{id}` link needs (its owner's, which for a member-of entry is not
// the profile being viewed), and whether it's there by membership.
export type ProfileChannelEntry = { channel: Channel; handle: string; memberOf: boolean };

// The channel list behind a profile grid, in the order it renders: the owner's
// channels as this viewer may see them, then — only on your own profile — the
// ones you've been invited to.
//
// The profile page and the load-more action both go through this, so the
// visibility rules are resolved from the session in one place. The action
// treats the ids it's handed as a hint and intersects them with this, so a
// crafted request can't render a channel the viewer couldn't already see.
export async function getProfileChannels(
  owner_id: string,
  owner_handle: string,
  viewer: ViewerScope,
): Promise<ProfileChannelEntry[]> {
  const own = !!viewer.ownerId && owner_id === viewer.ownerId;
  const [channels, memberChannels] = await Promise.all([
    own ? getOwnerChannels(owner_id) : getVisibleOwnerChannels(owner_id, viewer),
    own ? getMemberChannels(viewer) : Promise.resolve([]),
  ]);
  return [
    ...channels.map((ch) => ({ channel: ch, handle: owner_handle, memberOf: false })),
    ...memberChannels.map((ch) => ({ channel: ch, handle: ch.handle, memberOf: true })),
  ];
}

// A channel search hit, carrying the owner's handle so callers can build the
// `/{handle}/{id}` link without a second lookup.
export type ChannelSearchResult = Channel & { handle: string };

// Channels whose title/description or a tag match `query`, across everyone:
// every public/open channel, the viewer's own (including their private ones),
// and private group channels the viewer belongs to. Used by the nav search box,
// so capped to a handful of results. Returns [] for an empty/whitespace query.
export async function searchChannels(
  viewer: ViewerScope,
  query: string,
): Promise<ChannelSearchResult[]> {
  const term = sanitizeSearch(query);
  if (!term) {
    return [];
  }

  const pattern = `%${term}%`;
  const tag = term.replace(/["\\]/g, "");
  // A title match is what the searcher meant; a tag is a deliberate label; a
  // description mention is the weakest signal. Rank them in that order so
  // searching "design" finds the channel called Design before one that only
  // mentions design. Newest-first breaks ties, which also keeps the `limit`
  // below from returning an arbitrary ten rows.
  const rank = sql<number>`case
    when ${channel.title} ilike ${pattern} then 0
    when ${channel.tags} @> ARRAY[${tag}]::text[] then 1
    else 2
  end`;
  const rows = await db
    .select({ ch: channel, handle: owner.handle })
    .from(channel)
    .innerJoin(owner, eq(owner.id, channel.owned_by))
    .where(
      and(
        isVisibleSql(viewer),
        or(
          ilike(channel.title, pattern),
          ilike(channel.description, pattern),
          sql`${channel.tags} @> ARRAY[${tag}]::text[]`,
        ),
      ),
    )
    .orderBy(rank, desc(channel.created_at), desc(channel.id))
    .limit(10);
  return rows.map(({ ch, handle }) => ({ ...toChannel(ch), handle }));
}

export async function createChannel(input: {
  title: string;
  description?: string;
  access: ChannelAccess;
  owned_by: string;
}): Promise<Channel> {
  const [row] = await db.insert(channel).values(input).returning();
  await invalidateOwnerChannelLists(input.owned_by);
  return toChannel(row);
}

// Deletes a channel. Callers must authorize ownership first (this connection
// bypasses RLS). The channel's columns are removed by the ON DELETE CASCADE
// foreign key.
export async function deleteChannel(channel_id: number): Promise<void> {
  // Resolve the owner before the row is gone, so we can invalidate their lists.
  const ownedBy = await channelOwnedBy(channel_id);
  // Collect referenced media/URLs before the cascade removes the columns.
  const images = await channelImageUrls(channel_id);
  const linkUrls = await channelLinkUrls(channel_id);
  await db.delete(channel).where(eq(channel.id, channel_id));
  await invalidate(cacheKeys.channel(channel_id));
  if (ownedBy) await invalidateOwnerChannelLists(ownedBy);
  // Drop image-block media references (blobs GC when the last reference goes).
  for (const url of images) {
    await deleteMediaByUrl(url);
  }
  // URL blocks share a per-URL screenshot cache; the cascade above bypasses
  // deleteColumn, so GC any screenshot no surviving column still references.
  for (const url of linkUrls) {
    await deleteScreenshotIfUnreferenced(url);
  }
}

// Media URLs (image, pdf, and video blocks all store one in `image`) for a
// channel, so deleting the channel can drop their references and GC the blobs.
async function channelImageUrls(channel_id: number): Promise<string[]> {
  const rows = await db
    .select({ image: column.image })
    .from(column)
    .where(
      and(
        eq(column.channel_id, channel_id),
        or(eq(column.type, "image"), eq(column.type, "pdf"), eq(column.type, "video")),
      ),
    );
  return rows.map((r) => r.image).filter((image): image is string => image !== null);
}

// The owner of a channel, or null if it no longer exists. Used to target cache
// invalidation at the affected owner's channel lists.
async function channelOwnedBy(channel_id: number): Promise<string | null> {
  const [row] = await db
    .select({ owned_by: channel.owned_by })
    .from(channel)
    .where(eq(channel.id, channel_id))
    .limit(1);
  return row?.owned_by ?? null;
}

async function channelLinkUrls(channel_id: number): Promise<string[]> {
  const rows = await db
    .select({ url: column.url })
    .from(column)
    .where(and(eq(column.channel_id, channel_id), eq(column.type, "url")));
  return rows.map((r) => r.url).filter((url): url is string => url !== null);
}

// Updates an existing channel's editable fields. Callers must authorize
// ownership first. Throws if the channel no longer exists (no row returned).
export async function updateChannel(
  channel_id: number,
  updates: { title: string; description?: string; access: ChannelAccess; tags?: string[] },
): Promise<Channel> {
  const [row] = await db
    .update(channel)
    .set({ ...updates, updated_at: new Date() })
    .where(eq(channel.id, channel_id))
    .returning();
  if (!row) {
    throw new Error("Channel not found.");
  }
  await invalidate(cacheKeys.channel(channel_id));
  await invalidateOwnerChannelLists(row.owned_by);
  // Keep image-block media in sync with the channel's privacy so a flipped
  // channel's images follow it (idempotent, so no need to diff the old value).
  // Only `private` channels hide their images; open channels read publicly.
  await setMediaVisibilityByUrls(
    await channelImageUrls(channel_id),
    row.access === "private" ? "private" : "public",
  );
  return toChannel(row);
}

// Handles for a set of owner ids, for callers holding channels but not the
// owners their `/{handle}/{id}` links need.
export async function ownerHandles(ownerIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(ownerIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: owner.id, handle: owner.handle })
    .from(owner)
    .where(inArray(owner.id, ids));
  return new Map(rows.map((r) => [r.id, r.handle]));
}

// Returns the channel row, or null when it doesn't exist. Visibility is NOT
// enforced here — callers authorize reads explicitly (authorizeChannelRead for
// the API; an owner/private check for the channel page) so a private channel is
// never leaked.
// Wrapped in React cache() so generateMetadata and the page share one lookup
// per request (they both resolve the same channel). cache() keys on the id.
// The React cache() dedupes within a request; the Redis layer (cached()) spans
// requests. Invalidated on update/delete of the channel.
export const getChannel = cache(async (channel_id: number): Promise<Channel | null> => {
  if (!Number.isFinite(channel_id)) {
    return null;
  }
  return cached(cacheKeys.channel(channel_id), cacheTtl.channel, async () => {
    const [row] = await db.select().from(channel).where(eq(channel.id, channel_id)).limit(1);
    return row ? toChannel(row) : null;
  });
});
