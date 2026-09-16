import "server-only";

import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  // Where this item sits in the feed's order, as one opaque string. Hand the
  // last one back as `before` to get the next page; nothing else should read
  // it. See FEED ORDER below.
  cursor: string;
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

// Postgres keeps created_at to microseconds, but drizzle's `timestamp` column
// maps through a JS Date — millisecond precision — in both directions. A cursor
// read off one of those Dates is rounded down, and `created_at < cursor` then
// skipped anything written inside the boundary millisecond: older than the last
// item on the page, so not on it, and not older than the truncated cursor, so
// not on the next one either. Those rows reached no page at all.
//
// Reading the timestamp as text keeps the microseconds, and the cursor goes back
// as a timestamptz literal rather than through a Date, so neither side rounds.
// The format is fixed-width, so `at` still orders as a plain string compare, and
// a millisecond cursor issued by an older page still parses.
const preciseAt = (col: AnyPgColumn) =>
  sql<string>`to_char(${col} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const olderThan = (col: AnyPgColumn, cursor: string) => sql`${col} < ${cursor}::timestamptz`;

// FEED ORDER
//
// Three sources merge into one list, so "the next page" needs an order all four
// places agree on — the three queries and the merge itself. `created_at` alone
// is not one: two rows can share an instant, and then `< at` drops both while
// `<= at` repeats both. There is no third option without a tiebreak.
//
// The order is (at DESC, kind ASC, id DESC). `kind` separates the sources, so
// the id comparison only ever runs within one table and never has to compare a
// block id against an owner's uuid.
//
// An item comes after the cursor when its `at` is older, or its `at` matches
// and its kind sorts later, or both match and its id is lower. Per source that
// collapses to one of three predicates, which is what cursorFilter builds.
const KIND_RANK = { block: 0, channel: 1, user: 2 } as const;

type FeedCursor = { at: string; rank: number; id: string };

// `at|rank|id`. The timestamp is fixed-width and contains no pipe, so this
// splits cleanly.
function encodeCursor(at: string, kind: keyof typeof KIND_RANK, id: string | number): string {
  return `${at}|${KIND_RANK[kind]}|${id}`;
}

// A cursor with no `|` is one a page issued before this existed. Treated as a
// bare timestamp, which is exactly the old behaviour — so a page already open
// in someone's browser keeps paging rather than erroring or repeating itself.
function decodeCursor(before: string): FeedCursor | null {
  const parts = before.split("|");
  if (parts.length !== 3) return null;
  const rank = Number(parts[1]);
  if (!Number.isInteger(rank)) return null;
  return { at: parts[0], rank, id: parts[2] };
}

// The "strictly after the cursor" predicate for one source.
function cursorFilter(
  col: AnyPgColumn,
  idCol: AnyPgColumn,
  kind: keyof typeof KIND_RANK,
  before: string | undefined,
): SQL | undefined {
  if (!before) return undefined;
  const cursor = decodeCursor(before);
  // Legacy bare-timestamp cursor: the old millisecond-free comparison.
  if (!cursor) return olderThan(col, before);

  const rank = KIND_RANK[kind];
  if (rank < cursor.rank) return olderThan(col, cursor.at);
  if (rank > cursor.rank) return sql`${col} <= ${cursor.at}::timestamptz`;
  return sql`(${col} < ${cursor.at}::timestamptz or (${col} = ${cursor.at}::timestamptz and ${idCol} < ${cursor.id}))`;
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
  const ownerIds = viewerOwnerIds(viewer);
  // The block's creator is a person and the channel's owner is an owner row, so
  // the two handles come from the same table joined on different keys.
  const creator = alias(owner, "creator_owner");
  const channelOwner = alias(owner, "channel_owner");
  const [blocks, channels, joins] = await Promise.all([
    db
      .select({
        col: column,
        at: preciseAt(column.created_at),
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
          cursorFilter(column.created_at, column.id, "block", before),
        ),
      )
      .orderBy(desc(column.created_at))
      .limit(limit),
    db
      .select({
        at: preciseAt(channel.created_at),
        id: channel.id,
        handle: owner.handle,
        avatar: owner.avatar_url,
        channelId: channel.id,
        channelTitle: channel.title,
        channelDescription: channel.description,
      })
      .from(channel)
      .innerJoin(owner, eq(owner.id, channel.owned_by))
      .where(
        and(
          ne(channel.access, "private"),
          cursorFilter(channel.created_at, channel.id, "channel", before),
        ),
      )
      .orderBy(desc(channel.created_at))
      .limit(limit),
    // A member "joins" the network when they get a handle (onboard). Filtered to
    // people — a new group is not a new member of the network.
    db
      .select({
        at: preciseAt(owner.created_at),
        id: owner.id,
        handle: owner.handle,
        avatar: owner.avatar_url,
      })
      .from(owner)
      .where(and(eq(owner.kind, "user"), cursorFilter(owner.created_at, owner.id, "user", before)))
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
    ...blocks.map(({ col, at, handle, avatar, channelTitle, channelHandle }, i) => ({
      kind: "block" as const,
      at,
      cursor: encodeCursor(at, "block", col.id),
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
      at: c.at,
      cursor: encodeCursor(c.at, "channel", c.id),
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
      at: u.at,
      cursor: encodeCursor(u.at, "user", u.id),
      handle: u.handle,
      avatarUrl: u.avatar ?? undefined,
    })),
  ];

  // The same order the queries paged by, or the merge would hand back a page
  // whose last item isn't the one the next page continues from.
  return items.sort(compareItems).slice(0, limit);
}

// (at DESC, kind ASC, id DESC), matching cursorFilter. Ids are only ever
// compared within one kind, so a numeric id never meets a uuid; the string
// compare below is on values of the same shape. Returns 0 only for the same
// item, which is what makes this a total order rather than a stable-ish sort.
function compareItems(a: ActivityItem, b: ActivityItem): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (rank !== 0) return rank;
  const aId = a.cursor.slice(a.cursor.lastIndexOf("|") + 1);
  const bId = b.cursor.slice(b.cursor.lastIndexOf("|") + 1);
  if (aId === bId) return 0;
  // Numeric ids (blocks, channels) compare as numbers — "9" is not after "10".
  const aNum = Number(aId);
  const bNum = Number(bId);
  if (Number.isInteger(aNum) && Number.isInteger(bNum)) return bNum - aNum;
  return aId < bId ? 1 : -1;
}

// A channel-column ("connected X to Y") reads as its own sentence, so it never
// groups; neither do joins or new channels. Everything else — a plain block —
// can run together with its neighbours.
const groupable = (i: ActivityItem) => i.kind === "block" && i.column?.type !== "channel";

// Whether `item` carries on the run that `head` starts: the same person adding
// to the same channel, with nothing else in between.
const joinsRun = (head: ActivityItem, item: ActivityItem) =>
  groupable(head) &&
  groupable(item) &&
  head.handle === item.handle &&
  head.channelId === item.channelId;

// Consecutive adds by the same person to the same channel collapse into one
// feed entry, so a burst of uploads doesn't flood Explore. Each returned array
// is one feed row — most hold a single item. Pure so it's unit-testable.
export function groupActivity(items: ActivityItem[]): ActivityItem[][] {
  const groups: ActivityItem[][] = [];
  for (const item of items) {
    const prev = groups[groups.length - 1];
    if (prev && joinsRun(prev[0], item)) {
      prev.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups;
}

// How many extra pages one run may pull into its page. A burst longer than this
// splits the way it used to, which beats walking an entire channel to render a
// single collage.
const MAX_RUN_PAGES = 20;

// One page of the feed, with its trailing run left whole.
//
// `groupActivity` only ever sees one page, so a burst that straddles the page
// boundary used to come out as two collages. Pull the rest of the run into the
// page that starts it and move the cursor past everything taken, so the next
// page begins on a fresh group. Interleaving is handled by re-reading the merged
// feed: anything else that happened mid-burst ends the run, exactly as it does
// within a page.
export async function getActivityPage(
  viewer: ViewerScope,
  before?: string,
): Promise<{ items: ActivityItem[]; nextCursor: string | null; hasMore: boolean }> {
  const items = await getActivityFeed(viewer, ACTIVITY_PAGE, before);
  let hasMore = items.length === ACTIVITY_PAGE;

  for (let pages = 0; hasMore && pages < MAX_RUN_PAGES; pages++) {
    const last = items[items.length - 1];
    if (!groupable(last)) break;
    const more = await getActivityFeed(viewer, ACTIVITY_PAGE, last.cursor);
    const end = more.findIndex((i) => !joinsRun(last, i));
    const taken = end === -1 ? more : more.slice(0, end);
    items.push(...taken);
    // Something that isn't part of the run is still unread, so the run is over
    // and the next page picks up from there.
    if (taken.length < more.length) break;
    hasMore = more.length === ACTIVITY_PAGE;
  }

  return {
    items,
    nextCursor: items.length > 0 ? items[items.length - 1].cursor : null,
    hasMore,
  };
}
