import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { channel, column, userProfile } from "@/lib/db/schema";

// The Explore feed: recent public activity across the whole network. Colosseum
// is invite-only, so every member is connected — the network is everyone, and
// this is what they've been up to. Private channels (and their blocks) are
// filtered out, so nothing private ever surfaces here.

export type ActivityItem = {
  kind: "block" | "channel";
  at: string;
  handle: string;
  channelId: number;
  channelTitle: string;
  blockId?: number;
  label?: string;
};

// A short human label for a block in the feed. Pure so it's unit-testable.
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
  if (b.type === "channel") return "a channel";
  return "a block";
}

// Recent public blocks and channels, merged newest-first. Two capped queries,
// then merge + slice in memory.
export async function getActivityFeed(limit = 40): Promise<ActivityItem[]> {
  const [blocks, channels] = await Promise.all([
    db
      .select({
        at: column.created_at,
        handle: userProfile.handle,
        channelId: channel.id,
        channelTitle: channel.title,
        blockId: column.id,
        type: column.type,
        title: column.title,
        url: column.url,
        text: column.text,
      })
      .from(column)
      .innerJoin(channel, eq(channel.id, column.channel_id))
      .innerJoin(userProfile, eq(userProfile.user_id, column.created_by))
      .where(eq(channel.private, false))
      .orderBy(desc(column.created_at))
      .limit(limit),
    db
      .select({
        at: channel.created_at,
        handle: userProfile.handle,
        channelId: channel.id,
        channelTitle: channel.title,
      })
      .from(channel)
      .innerJoin(userProfile, eq(userProfile.user_id, channel.owner_id))
      .where(eq(channel.private, false))
      .orderBy(desc(channel.created_at))
      .limit(limit),
  ]);

  const items: ActivityItem[] = [
    ...blocks.map((b) => ({
      kind: "block" as const,
      at: b.at.toISOString(),
      handle: b.handle,
      channelId: b.channelId,
      channelTitle: b.channelTitle,
      blockId: b.blockId,
      label: blockLabel(b),
    })),
    ...channels.map((c) => ({
      kind: "channel" as const,
      at: c.at.toISOString(),
      handle: c.handle,
      channelId: c.channelId,
      channelTitle: c.channelTitle,
    })),
  ];

  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
