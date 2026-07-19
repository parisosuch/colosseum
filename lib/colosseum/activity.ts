import "server-only";

import { and, desc, eq, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { channel, channelMember, column, userProfile } from "@/lib/db/schema";

import { toColumn, withLinkedChannels, type Column } from "./column";
import { getScreenshotsForUrls, type ColumnScreenshot } from "./screenshot-data";

// Feed page size, shared by the page, the load-more action, and the has-more
// check (a full page returned ⇒ there may be more).
export const ACTIVITY_PAGE = 24;

// The Explore feed: recent public activity across the whole network. Colosseum
// is invite-only, so every member is connected — the network is everyone, and
// this is what they've been up to. Public/open channels surface to everyone;
// blocks in a private channel surface only to that channel's owner and members
// (so a group's members see what each other add), never to anyone else. New
// private *channels* themselves never surface — only the blocks inside ones the
// viewer already belongs to.

export type ActivityItem = {
  kind: "block" | "channel" | "user";
  at: string;
  handle: string;
  // block / channel only.
  channelId?: number;
  channelTitle?: string;
  // channel (created) only — shown on the focal card like a normal channel.
  channelDescription?: string;
  label?: string;
  // The block itself, for a `block` item — so the feed can render its preview
  // as the focal point (image, screenshot, or text) rather than just naming it.
  column?: Column;
  // Cached website screenshot for a `url` block, so its modal shows the capture
  // the way the channel view does.
  screenshot?: ColumnScreenshot;
  // The actor's avatar: the focal point for a `user` (join) item, and shown
  // beside their handle in the attribution line for every kind. Absent when the
  // user has no avatar set.
  avatarUrl?: string;
};

// A short human label for a block, used for the feed caption / aria. Pure so
// it's unit-testable.
export function blockLabel(b: {
  type: string;
  title: string | null;
  url: string | null;
  text: string | null;
}): string {
  if (b.title) return b.title;
  if (b.type === "url") return (b.url ?? "a link").replace(/^https?:\/\//, "");
  if (b.type === "text") return b.text ? b.text.slice(0, 60) : "a note";
  if (b.type === "image") return "an image";
  if (b.type === "pdf") return "a PDF";
  if (b.type === "video") return "a video";
  if (b.type === "channel") return "a channel";
  return "a column";
}

// Recent public blocks, channels, and new members, merged newest-first. Capped
// queries (indexed on created_at), then merge + slice in memory. `before` is a
// cursor — the `at` of the last item seen — so each source returns only older
// rows for the next page.
export async function getActivityFeed(
  viewerId: string | null,
  limit = ACTIVITY_PAGE,
  before?: string,
): Promise<ActivityItem[]> {
  const cursor = before ? new Date(before) : null;
  const [blocks, channels, joins] = await Promise.all([
    db
      .select({
        col: column,
        handle: userProfile.handle,
        avatar: userProfile.avatar_url,
        channelTitle: channel.title,
      })
      .from(column)
      .innerJoin(channel, eq(channel.id, column.channel_id))
      .innerJoin(userProfile, eq(userProfile.user_id, column.created_by))
      .where(
        and(
          // Non-private channels are visible to everyone; a private channel's
          // blocks only to its owner or a member — so nothing private leaks to
          // outsiders, but a group sees its own members' additions.
          or(
            ne(channel.access, "private"),
            viewerId ? eq(channel.owner_id, viewerId) : undefined,
            viewerId
              ? sql`exists (select 1 from ${channelMember} where ${channelMember.channel_id} = ${channel.id} and ${channelMember.user_id} = ${viewerId})`
              : undefined,
          ),
          cursor ? lt(column.created_at, cursor) : undefined,
        ),
      )
      .orderBy(desc(column.created_at))
      .limit(limit),
    db
      .select({
        at: channel.created_at,
        handle: userProfile.handle,
        avatar: userProfile.avatar_url,
        channelId: channel.id,
        channelTitle: channel.title,
        channelDescription: channel.description,
      })
      .from(channel)
      .innerJoin(userProfile, eq(userProfile.user_id, channel.owner_id))
      .where(
        and(ne(channel.access, "private"), cursor ? lt(channel.created_at, cursor) : undefined),
      )
      .orderBy(desc(channel.created_at))
      .limit(limit),
    // A member "joins" the network when they get a handle (onboard).
    db
      .select({
        at: userProfile.created_at,
        handle: userProfile.handle,
        avatar: userProfile.avatar_url,
      })
      .from(userProfile)
      .where(cursor ? lt(userProfile.created_at, cursor) : undefined)
      .orderBy(desc(userProfile.created_at))
      .limit(limit),
  ]);

  const urls = blocks.filter((b) => b.col.type === "url" && b.col.url).map((b) => b.col.url!);
  const [blockColumns, shots] = await Promise.all([
    // Enrich channel-columns with their linked channel (title/handle/count) so
    // the feed can render and link them like the channel grid does.
    // `b.handle` is joined on column.created_by, so it's the creator's handle —
    // attach it directly rather than re-querying via withCreators.
    withLinkedChannels(
      blocks.map((b) => ({ ...toColumn(b.col), created_by_handle: b.handle })),
      viewerId,
    ),
    // Cached screenshots for the url blocks, so their modals show the capture.
    urls.length
      ? getScreenshotsForUrls(urls)
      : Promise.resolve(new Map<string, ColumnScreenshot>()),
  ]);

  const items: ActivityItem[] = [
    ...blocks.map(({ col, handle, avatar, channelTitle }, i) => ({
      kind: "block" as const,
      at: col.created_at.toISOString(),
      handle,
      avatarUrl: avatar ?? undefined,
      channelId: col.channel_id,
      channelTitle,
      label: blockLabel(col),
      column: blockColumns[i],
      screenshot: col.type === "url" && col.url ? shots.get(col.url) : undefined,
    })),
    ...channels.map((c) => ({
      kind: "channel" as const,
      at: c.at.toISOString(),
      handle: c.handle,
      avatarUrl: c.avatar ?? undefined,
      channelId: c.channelId,
      channelTitle: c.channelTitle,
      channelDescription: c.channelDescription ?? undefined,
    })),
    ...joins.map((u) => ({
      kind: "user" as const,
      at: u.at.toISOString(),
      handle: u.handle,
      avatarUrl: u.avatar ?? undefined,
    })),
  ];

  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
