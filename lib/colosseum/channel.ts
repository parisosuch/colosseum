import { cache } from "react";

import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { channel, channelMember, column, userProfile } from "@/lib/db/schema";
import { sanitizeSearch } from "@/lib/utils";
import { deleteMediaByUrl, setMediaVisibilityByUrls } from "./blob";
import { deleteScreenshotIfUnreferenced } from "./column";

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
  owner_id: string;
  updated_at?: string;
  tags: string[];
};

// SQL predicate: does `user_id` have a channel_member row for `channel.id`?
// Signed-out viewers (null) never match.
function isMemberSql(user_id: string | null) {
  if (!user_id) return sql`false`;
  return sql`exists (select 1 from ${channelMember} where ${channelMember.channel_id} = ${channel.id} and ${channelMember.user_id} = ${user_id})`;
}

// ---------------------------------------------------------------------------
// Access predicates — the single source of the authorization matrix. Callers
// resolve `isMember` (see member.ts) and pass it in; public/open reads ignore it.
// ---------------------------------------------------------------------------

// Read: public/open are visible to anyone; private only to the owner or a member.
export function canReadChannel(ch: Channel, userId: string | null, isMember: boolean): boolean {
  if (ch.access !== "private") return true;
  return userId === ch.owner_id || isMember;
}

// Add blocks: open → any signed-in user; public and private → the owner or an
// invited member. (A public channel with no members is therefore owner-only; add
// members to make it a publicly-readable, members-only-writable channel.)
export function canContributeChannel(
  ch: Channel,
  userId: string | null,
  isMember: boolean,
): boolean {
  if (!userId) return false;
  if (ch.access === "open") return true;
  return userId === ch.owner_id || isMember;
}

// Manage (settings, delete, members): owner only, whatever the access mode.
export function canManageChannel(ch: Channel, userId: string | null): boolean {
  return !!userId && userId === ch.owner_id;
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
    owner_id: row.owner_id,
    updated_at: row.updated_at?.toISOString() ?? undefined,
    tags: row.tags,
  };
}

// Order channels by their most recently added block, so a channel bubbles up
// when the owner drops something new in it. Channels with no blocks yet fall
// back to their own creation time.
const lastBlockAddedAt = sql`coalesce((select max(${column.created_at}) from ${column} where ${column.channel_id} = ${channel.id}), ${channel.created_at})`;

export async function getUserPublicChannels(user_id: string): Promise<Channel[]> {
  const rows = await db
    .select()
    .from(channel)
    .where(and(eq(channel.owner_id, user_id), ne(channel.access, "private")))
    .orderBy(desc(lastBlockAddedAt));
  return rows.map(toChannel);
}

export async function getUserChannels(user_id: string): Promise<Channel[]> {
  const rows = await db
    .select()
    .from(channel)
    .where(eq(channel.owner_id, user_id))
    .orderBy(desc(lastBlockAddedAt));
  return rows.map(toChannel);
}

// The owner's channels as visible to `viewer_id`: every public/open one, plus
// private ones the viewer owns or is a member of. Backs the profile grid so an
// invited member sees the private group channels they belong to.
export async function getVisibleUserChannels(
  owner_id: string,
  viewer_id: string | null,
): Promise<Channel[]> {
  const rows = await db
    .select()
    .from(channel)
    .where(
      and(
        eq(channel.owner_id, owner_id),
        or(
          ne(channel.access, "private"),
          // The owner sees their own private channels; members see theirs.
          viewer_id ? eq(channel.owner_id, viewer_id) : undefined,
          isMemberSql(viewer_id),
        ),
      ),
    )
    .orderBy(desc(lastBlockAddedAt));
  return rows.map(toChannel);
}

// A channel search hit, carrying the owner's handle so callers can build the
// `/{handle}/{id}` link without a second lookup.
export type ChannelSearchResult = Channel & { handle: string };

// Channels whose title/description or a tag match `query`, across everyone:
// every public/open channel, the viewer's own (including their private ones),
// and private group channels the viewer belongs to. Used by the nav search box,
// so capped to a handful of results. Returns [] for an empty/whitespace query.
export async function searchChannels(
  viewer_id: string,
  query: string,
): Promise<ChannelSearchResult[]> {
  const term = sanitizeSearch(query);
  if (!term) {
    return [];
  }

  const pattern = `%${term}%`;
  const tag = term.replace(/["\\]/g, "");
  const rows = await db
    .select({ ch: channel, handle: userProfile.handle })
    .from(channel)
    .innerJoin(userProfile, eq(userProfile.user_id, channel.owner_id))
    .where(
      and(
        or(ne(channel.access, "private"), eq(channel.owner_id, viewer_id), isMemberSql(viewer_id)),
        or(
          ilike(channel.title, pattern),
          ilike(channel.description, pattern),
          sql`${channel.tags} @> ARRAY[${tag}]::text[]`,
        ),
      ),
    )
    .limit(10);
  return rows.map(({ ch, handle }) => ({ ...toChannel(ch), handle }));
}

export async function createChannel(input: {
  title: string;
  description?: string;
  access: ChannelAccess;
  owner_id: string;
}): Promise<Channel> {
  const [row] = await db.insert(channel).values(input).returning();
  return toChannel(row);
}

// Deletes a channel. Callers must authorize ownership first (this connection
// bypasses RLS). The channel's columns are removed by the ON DELETE CASCADE
// foreign key.
export async function deleteChannel(channel_id: number): Promise<void> {
  // Collect referenced media/URLs before the cascade removes the columns.
  const images = await channelImageUrls(channel_id);
  const linkUrls = await channelLinkUrls(channel_id);
  await db.delete(channel).where(eq(channel.id, channel_id));
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

// Media URLs (image and pdf blocks both store one in `image`) for a channel,
// so deleting the channel can drop their references and GC the blobs.
async function channelImageUrls(channel_id: number): Promise<string[]> {
  const rows = await db
    .select({ image: column.image })
    .from(column)
    .where(
      and(eq(column.channel_id, channel_id), or(eq(column.type, "image"), eq(column.type, "pdf"))),
    );
  return rows.map((r) => r.image).filter((image): image is string => image !== null);
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
  // Keep image-block media in sync with the channel's privacy so a flipped
  // channel's images follow it (idempotent, so no need to diff the old value).
  // Only `private` channels hide their images; open channels read publicly.
  await setMediaVisibilityByUrls(
    await channelImageUrls(channel_id),
    row.access === "private" ? "private" : "public",
  );
  return toChannel(row);
}

// Returns the channel row, or null when it doesn't exist. Visibility is NOT
// enforced here — callers authorize reads explicitly (authorizeChannelRead for
// the API; an owner/private check for the channel page) so a private channel is
// never leaked.
// Wrapped in React cache() so generateMetadata and the page share one lookup
// per request (they both resolve the same channel). cache() keys on the id.
export const getChannel = cache(async (channel_id: number): Promise<Channel | null> => {
  if (!Number.isFinite(channel_id)) {
    return null;
  }
  const [row] = await db.select().from(channel).where(eq(channel.id, channel_id)).limit(1);
  return row ? toChannel(row) : null;
});
