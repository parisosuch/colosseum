import "server-only";

import { and, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { channel, channelMember, column, owner } from "@/lib/db/schema";

import { viewerOwnerIds, type ViewerScope } from "./viewer";
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
  // The channel owner's handle. A channel lives under its owner, so its links
  // are `/{channelHandle}/{channelId}` — not `handle`, which is the actor and
  // for a block is whoever added it (a member, not necessarily the owner).
  channelHandle?: string;
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
  viewer: ViewerScope,
  limit = ACTIVITY_PAGE,
  before?: string,
): Promise<ActivityItem[]> {
  const cursor = before ? new Date(before) : null;
  const ownerIds = viewerOwnerIds(viewer);
  // The block's creator is a person and the channel's owner is an owner row, so
  // the two handles come from the same table joined on different keys.
  const creator = alias(owner, "creator_owner");
  const channelOwner = alias(owner, "channel_owner");
  const [blocks, channels, joins] = await Promise.all([
    db
      .select({
        col: column,
        handle: creator.handle,
        avatar: creator.avatar_url,
        channelTitle: channel.title,
        channelHandle: channelOwner.handle,
      })
      .from(column)
      .innerJoin(channel, eq(channel.id, column.channel_id))
      .innerJoin(creator, eq(creator.user_id, column.created_by))
      .innerJoin(channelOwner, eq(channelOwner.id, channel.owned_by))
      .where(
        and(
          // Non-private channels are visible to everyone; a private channel's
          // blocks only to its owner or a member — so nothing private leaks to
          // outsiders, but a group sees its own members' additions.
          or(
            ne(channel.access, "private"),
            ownerIds.length > 0 ? inArray(channel.owned_by, ownerIds) : undefined,
            viewer.userId
              ? sql`exists (select 1 from ${channelMember} where ${channelMember.channel_id} = ${channel.id} and ${channelMember.user_id} = ${viewer.userId})`
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
        handle: owner.handle,
        avatar: owner.avatar_url,
        channelId: channel.id,
        channelTitle: channel.title,
        channelDescription: channel.description,
      })
      .from(channel)
      .innerJoin(owner, eq(owner.id, channel.owned_by))
      .where(
        and(ne(channel.access, "private"), cursor ? lt(channel.created_at, cursor) : undefined),
      )
      .orderBy(desc(channel.created_at))
      .limit(limit),
    // A member "joins" the network when they get a handle (onboard). Filtered to
    // people — a new group is not a new member of the network.
    db
      .select({
        at: owner.created_at,
        handle: owner.handle,
        avatar: owner.avatar_url,
      })
      .from(owner)
      .where(and(eq(owner.kind, "user"), cursor ? lt(owner.created_at, cursor) : undefined))
      .orderBy(desc(owner.created_at))
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
      viewer,
    ),
    // Cached screenshots for the url blocks, so their modals show the capture.
    urls.length
      ? getScreenshotsForUrls(urls)
      : Promise.resolve(new Map<string, ColumnScreenshot>()),
  ]);

  const items: ActivityItem[] = [
    ...blocks.map(({ col, handle, avatar, channelTitle, channelHandle }, i) => ({
      kind: "block" as const,
      at: col.created_at.toISOString(),
      handle,
      avatarUrl: avatar ?? undefined,
      channelId: col.channel_id,
      channelTitle,
      channelHandle,
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
      // Joined on the channel's owner, so the actor is the owner here.
      channelHandle: c.handle,
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

// Consecutive adds by the same person to the same channel collapse into one
// feed entry, so a burst of uploads doesn't flood Explore. A channel-column
// ("connected X to Y") reads as its own sentence, so it never groups; neither
// do joins or new channels. Each returned array is one feed row — most hold a
// single item. Pure so it's unit-testable.
export function groupActivity(items: ActivityItem[]): ActivityItem[][] {
  const groupable = (i: ActivityItem) => i.kind === "block" && i.column?.type !== "channel";
  const groups: ActivityItem[][] = [];
  for (const item of items) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      groupable(item) &&
      groupable(prev[0]) &&
      prev[0].handle === item.handle &&
      prev[0].channelId === item.channelId
    ) {
      prev.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups;
}
