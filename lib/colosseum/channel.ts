import { and, eq, ilike, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { channel, column } from "@/lib/db/schema";
import { sanitizeSearch } from "@/lib/utils";
import { deleteMediaByUrl, setMediaVisibilityByUrls } from "./blob";

export type Channel = {
  id: number;
  created_at: string;
  title: string;
  description?: string;
  private: boolean;
  owner_id: string;
  updated_at?: string;
  tags: string[];
};

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
    private: row.private,
    owner_id: row.owner_id,
    updated_at: row.updated_at?.toISOString() ?? undefined,
    tags: row.tags,
  };
}

export async function getUserPublicChannels(user_id: string): Promise<Channel[]> {
  const rows = await db
    .select()
    .from(channel)
    .where(and(eq(channel.owner_id, user_id), eq(channel.private, false)));
  return rows.map(toChannel);
}

export async function getUserChannels(user_id: string): Promise<Channel[]> {
  const rows = await db.select().from(channel).where(eq(channel.owner_id, user_id));
  return rows.map(toChannel);
}

// Channels the user owns whose title/description or a tag match `query`. Used by
// the nav search box, so capped to a handful of results. Returns [] for an
// empty/whitespace-only query rather than the user's whole channel list.
export async function searchUserChannels(user_id: string, query: string): Promise<Channel[]> {
  const term = sanitizeSearch(query);
  if (!term) {
    return [];
  }

  const pattern = `%${term}%`;
  const tag = term.replace(/["\\]/g, "");
  const rows = await db
    .select()
    .from(channel)
    .where(
      and(
        eq(channel.owner_id, user_id),
        or(
          ilike(channel.title, pattern),
          ilike(channel.description, pattern),
          sql`${channel.tags} @> ARRAY[${tag}]::text[]`,
        ),
      ),
    )
    .limit(10);
  return rows.map(toChannel);
}

export async function createChannel(input: {
  title: string;
  description?: string;
  private: boolean;
  owner_id: string;
}): Promise<Channel> {
  const [row] = await db.insert(channel).values(input).returning();
  return toChannel(row);
}

// Deletes a channel. Callers must authorize ownership first (this connection
// bypasses RLS). The channel's columns are removed by the ON DELETE CASCADE
// foreign key. Screenshots are a shared per-URL cache and are left untouched.
export async function deleteChannel(channel_id: number): Promise<void> {
  // Collect image URLs before the cascade removes the columns, then drop their
  // media references (blobs GC when the last reference goes).
  const images = await channelImageUrls(channel_id);
  await db.delete(channel).where(eq(channel.id, channel_id));
  for (const url of images) {
    await deleteMediaByUrl(url);
  }
}

async function channelImageUrls(channel_id: number): Promise<string[]> {
  const rows = await db
    .select({ image: column.image })
    .from(column)
    .where(and(eq(column.channel_id, channel_id), eq(column.type, "image")));
  return rows.map((r) => r.image).filter((image): image is string => image !== null);
}

// Updates an existing channel's editable fields. Callers must authorize
// ownership first. Throws if the channel no longer exists (no row returned).
export async function updateChannel(
  channel_id: number,
  updates: { title: string; description?: string; private: boolean; tags?: string[] },
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
  await setMediaVisibilityByUrls(
    await channelImageUrls(channel_id),
    row.private ? "private" : "public",
  );
  return toChannel(row);
}

// Returns the channel row, or null when it doesn't exist. Visibility is NOT
// enforced here — callers authorize reads explicitly (authorizeChannelRead for
// the API; an owner/private check for the channel page) so a private channel is
// never leaked.
export async function getChannel(channel_id: number): Promise<Channel | null> {
  if (!Number.isFinite(channel_id)) {
    return null;
  }
  const [row] = await db.select().from(channel).where(eq(channel.id, channel_id)).limit(1);
  return row ? toChannel(row) : null;
}
