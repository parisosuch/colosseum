import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import { channel, channelMember, column, screenshot, userProfile } from "@/lib/db/schema";
import { renderMarkdown } from "@/lib/markdown";
import { sanitizeSearch } from "@/lib/utils";
import { deleteMediaByUrl } from "./blob";
import { deleteTweetIfUnreferenced } from "./tweet";
import { tweetIdFromUrl } from "@/lib/utils";

export type Column = {
  id: number;
  created_at: string;
  type:
    | "url"
    | "text"
    | "image"
    | "channel"
    | "pdf"
    | "video"
    | "tweet"
    | "youtube"
    | "youtube_channel"
    | "spotify";
  title?: string;
  description?: string;
  url?: string;
  text?: string;
  // A `text` block's markdown rendered to sanitized HTML, filled by toColumn so
  // every block carries it however it was fetched (first page, load-more,
  // just-created). Clients render this instead of parsing the markdown
  // themselves, which keeps `marked` and `sanitize-html` out of the browser and
  // makes the server the only place HTML is ever produced.
  //
  // Absent on the fetch paths that pass `{ html: false }` — the export and the
  // REST/MCP reads, which return the markdown source and never render it. Every
  // path that puts a block in front of a viewer takes the default and gets it.
  html?: string;
  // Media URL of the uploaded blob for `image` columns, and reused for `pdf`
  // columns (the stored file is a PDF, served by /api/media with its own mime).
  image?: string;
  created_by: string;
  // The creator's handle, resolved from `created_by`. Filled by withCreators
  // (getChannelColumns, getColumn); absent on unenriched fetch paths.
  created_by_handle?: string;
  channel_id: number;
  // Set for `channel` columns: the channel this column links to.
  linked_channel_id?: number;
  // Resolved display info for a `channel` column's linked channel (title,
  // description, owner handle for the link target, block count). Filled by
  // getChannelColumns.
  linked_channel?: { title: string; description?: string; handle: string; count: number };
  tags: string[];
};

type ColumnRow = typeof column.$inferSelect;

// Per-call rendering options for the row → Column conversion.
export type ColumnRender = {
  // Render a `text` block's markdown into `html`. Defaults to true, so a block
  // carries its HTML however it was fetched. Pass false only where the result
  // is known never to be rendered — the channel export and the REST/MCP reads,
  // which hand back the markdown source — since the render is pure CPU there
  // and doubles a text block's payload on the way out.
  html?: boolean;
};

// The single row → Column conversion. Every fetch, insert and update path in the
// data layer goes through it, which is why the rendered markdown is produced
// here: a Column's `html` can never be stale, and can only be missing where a
// caller explicitly opted out of rendering it.
export function toColumn(row: ColumnRow, render: ColumnRender = {}): Column {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    type: row.type,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    url: row.url ?? undefined,
    text: row.text ?? undefined,
    html:
      render.html !== false && row.type === "text" && row.text
        ? renderMarkdown(row.text)
        : undefined,
    image: row.image ?? undefined,
    created_by: row.created_by,
    channel_id: row.channel_id,
    linked_channel_id: row.linked_channel_id ?? undefined,
    tags: row.tags,
  };
}

// Resolve display info for `channel` columns: the linked channel's title, its
// owner's handle (the link target is /handle/id), and its block count. Batched
// so a board with several channel columns still runs two queries, not 2N.
// `viewerId` (the current user, or null when signed out) gates privacy:
// privacy is re-checked live here, not just at link creation, so a linked
// channel that has since gone private resolves no display data for anyone but
// its owner — the column then renders as a removed link.
export async function withLinkedChannels(
  cols: Column[],
  viewerId: string | null,
): Promise<Column[]> {
  const linkedIds = [
    ...new Set(cols.map((c) => c.linked_channel_id).filter((id): id is number => id != null)),
  ];
  if (linkedIds.length === 0) return cols;

  const [meta, counts] = await Promise.all([
    db
      .select({
        id: channel.id,
        title: channel.title,
        description: channel.description,
        handle: userProfile.handle,
      })
      .from(channel)
      .innerJoin(userProfile, eq(userProfile.user_id, channel.owner_id))
      .where(
        and(
          inArray(channel.id, linkedIds),
          or(ne(channel.access, "private"), viewerId ? eq(channel.owner_id, viewerId) : undefined),
        ),
      ),
    db
      .select({ channel_id: column.channel_id, n: sql<number>`count(*)::int` })
      .from(column)
      .where(inArray(column.channel_id, linkedIds))
      .groupBy(column.channel_id),
  ]);

  const metaById = new Map(meta.map((m) => [m.id, m]));
  const countById = new Map(counts.map((c) => [c.channel_id, c.n]));

  return cols.map((c) => {
    if (c.linked_channel_id == null) return c;
    const m = metaById.get(c.linked_channel_id);
    if (!m) return c;
    return {
      ...c,
      linked_channel: {
        title: m.title,
        description: m.description ?? undefined,
        handle: m.handle,
        count: countById.get(m.id) ?? 0,
      },
    };
  });
}

// Resolve each block's creator handle from `created_by`. Batched so a board of
// N blocks runs one extra query, not N. A block whose creator has no profile
// (or was deleted) simply keeps `created_by_handle` undefined.
export async function withCreators(cols: Column[]): Promise<Column[]> {
  const ids = [...new Set(cols.map((c) => c.created_by))];
  if (ids.length === 0) return cols;
  const rows = await db
    .select({ user_id: userProfile.user_id, handle: userProfile.handle })
    .from(userProfile)
    .where(inArray(userProfile.user_id, ids));
  const handleById = new Map(rows.map((r) => [r.user_id, r.handle]));
  return cols.map((c) => ({ ...c, created_by_handle: handleById.get(c.created_by) }));
}

// Fetch a single block by id. Returns null when it doesn't exist. Visibility is
// NOT enforced here — callers authorize via the block's channel first.
export async function getColumn(
  column_id: number,
  render: ColumnRender = {},
): Promise<Column | null> {
  // A non-numeric route param (e.g. parseInt("foo") → NaN) is never a real id;
  // treat it as not-found instead of letting Postgres reject NaN for a bigint.
  if (!Number.isFinite(column_id)) {
    return null;
  }
  const [row] = await db.select().from(column).where(eq(column.id, column_id)).limit(1);
  if (!row) return null;
  const [enriched] = await withCreators([toColumn(row, render)]);
  return enriched;
}

export type ColumnSort = "newest" | "oldest" | "title_az" | "title_za";
export type ColumnFilter = "all" | "url" | "text" | "image";

// Options for querying a channel's blocks. Every channel-page control feeds the
// same query so search, type-filter, ordering and paging compose server-side
// (rather than filtering a fully-loaded list on the client).
export type ColumnQuery = {
  // Case-insensitive substring matched against title/description/text/url.
  search?: string;
  // Block type to keep; "all" (the default) applies no type filter.
  type?: ColumnFilter;
  // Result ordering; defaults to "newest".
  sort?: ColumnSort;
  // Page size. Omit for all rows (used by exports and the profile preview).
  limit?: number;
  // Row offset for paged load-more; used together with `limit`.
  offset?: number;
  // Render text blocks' markdown into `html` (see ColumnRender). Defaults to
  // true; the export and the REST/MCP list pass false. An unbounded read of a
  // channel full of long text blocks is the most expensive shape this query
  // has, and those callers hand back the markdown source instead.
  html?: boolean;
};

// Callers must authorize the channel's visibility before calling this (see the
// channel page and authorizeChannelRead); it returns every block in the channel.
export async function getChannelColumns(
  channel_id: number,
  query: ColumnQuery = {},
  viewerId: string | null = null,
): Promise<Column[]> {
  const { search, type = "all", sort = "newest", limit, offset = 0, html } = query;

  const filters: SQL[] = [eq(column.channel_id, channel_id)];

  if (type !== "all") {
    filters.push(eq(column.type, type));
  }

  const term = search ? sanitizeSearch(search) : "";
  if (term) {
    const pattern = `%${term}%`;
    const tag = term.replace(/["\\]/g, "");
    filters.push(
      or(
        ilike(column.title, pattern),
        ilike(column.description, pattern),
        ilike(column.text, pattern),
        ilike(column.url, pattern),
        sql`${column.tags} @> ARRAY[${tag}]::text[]`,
      )!,
    );
  }

  const orderBy: SQL = (() => {
    switch (sort) {
      case "oldest":
        return asc(column.created_at);
      case "title_az":
        return sql`${column.title} asc nulls last`;
      case "title_za":
        return sql`${column.title} desc nulls last`;
      default:
        return desc(column.created_at);
    }
  })();

  const rows = await db
    .select()
    .from(column)
    .where(and(...filters))
    .orderBy(orderBy)
    .limit(limit ?? Number.MAX_SAFE_INTEGER)
    .offset(offset);

  return withCreators(
    await withLinkedChannels(
      rows.map((row) => toColumn(row, { html })),
      viewerId,
    ),
  );
}

// The `perChannel` newest blocks for each of `channelIds`, as one windowed query
// rather than a query per channel. Backs the profile grid previews, which show a
// handful of channels each with its first few blocks. Returns a map keyed by
// channel id (a channel with no blocks is simply absent); each list is
// newest-first. Channel-link blocks are enriched once across all channels.
export async function getTopColumnsByChannel(
  channelIds: number[],
  perChannel: number,
  viewerId: string | null = null,
): Promise<Map<number, Column[]>> {
  const byChannel = new Map<number, Column[]>();
  if (channelIds.length === 0) return byChannel;

  const ranked = db
    .select({
      ...getTableColumns(column),
      rn: sql<number>`row_number() over (partition by ${column.channel_id} order by ${column.created_at} desc)`.as(
        "rn",
      ),
    })
    .from(column)
    .where(inArray(column.channel_id, channelIds))
    .as("ranked");

  const rows = await db
    .select()
    .from(ranked)
    .where(lte(ranked.rn, perChannel))
    .orderBy(ranked.channel_id, ranked.rn);

  const enriched = await withLinkedChannels(
    rows.map((r) => toColumn(r)),
    viewerId,
  );
  for (const col of enriched) {
    const list = byChannel.get(col.channel_id);
    if (list) list.push(col);
    else byChannel.set(col.channel_id, [col]);
  }
  return byChannel;
}

// A block search hit, carrying the owning channel's handle so callers can build
// the `/{handle}/{channel_id}/{id}` link without a second lookup.
export type ColumnSearchResult = Column & { handle: string };

// Blocks whose title/description/text/url or a tag match `query`, across
// everyone: every block in a public channel plus those in the viewer's own
// channels (including private ones). Used by the nav search box, so capped to a
// handful of results. Returns [] for an empty/whitespace-only query.
export async function searchColumns(
  viewer_id: string,
  query: string,
): Promise<ColumnSearchResult[]> {
  const term = sanitizeSearch(query);
  if (!term) {
    return [];
  }

  const pattern = `%${term}%`;
  const tag = term.replace(/["\\]/g, "");
  const rows = await db
    .select({ col: column, handle: userProfile.handle })
    .from(column)
    .innerJoin(channel, eq(channel.id, column.channel_id))
    .innerJoin(userProfile, eq(userProfile.user_id, channel.owner_id))
    .where(
      and(
        or(
          ne(channel.access, "private"),
          eq(channel.owner_id, viewer_id),
          sql`exists (select 1 from ${channelMember} where ${channelMember.channel_id} = ${channel.id} and ${channelMember.user_id} = ${viewer_id})`,
        ),
        or(
          ilike(column.title, pattern),
          ilike(column.description, pattern),
          ilike(column.text, pattern),
          ilike(column.url, pattern),
          sql`${column.tags} @> ARRAY[${tag}]::text[]`,
        ),
      ),
    )
    .limit(10);
  return rows.map(({ col, handle }) => ({ ...toColumn(col), handle }));
}

export async function uploadURLColumn(input: {
  created_by: string;
  channel_id: number;
  text: string;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "url",
      url: input.text,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

// A tweet block reuses the `url` field for the tweet's permalink; the persisted
// snapshot lives in the shared `tweet` table (keyed by the tweet id), captured
// before this runs. Renders as an embedded tweet from that snapshot.
export async function uploadTweetColumn(input: {
  created_by: string;
  channel_id: number;
  url: string;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "tweet",
      url: input.url,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

// A YouTube block reuses the `url` field for the video's watch URL, with the
// video's title stored as the block title. Nothing else is persisted — the
// embed renders live from YouTube (per issue, snapshotting video would be too
// costly), so there's no capture step and no GC.
export async function uploadYouTubeColumn(input: {
  created_by: string;
  channel_id: number;
  url: string;
  title?: string;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "youtube",
      url: input.url,
      title: input.title,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

// A YouTube channel block. There's no embeddable player for a channel, so this
// stores what a card needs: the channel URL, its name as the block title, its
// blurb as the description, and its avatar in `image` (ingested into our own
// storage, so the card doesn't break when YouTube rotates the URL).
export async function uploadYouTubeChannelColumn(input: {
  created_by: string;
  channel_id: number;
  url: string;
  title?: string;
  description?: string;
  image?: string;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "youtube_channel",
      url: input.url,
      title: input.title,
      description: input.description,
      image: input.image,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

// A Spotify block reuses the `url` field for the open.spotify.com URL, storing
// the item's title as the block title and its cover-art URL in `image` (an
// external URL, like a link-image block — deleteMediaByUrl no-ops on it). The
// player renders live from Spotify's iframe; nothing else is captured.
export async function uploadSpotifyColumn(input: {
  created_by: string;
  channel_id: number;
  url: string;
  title?: string;
  image?: string;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "spotify",
      url: input.url,
      title: input.title,
      image: input.image,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

export async function uploadTextColumn(input: {
  created_by: string;
  channel_id: number;
  text: string;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "text",
      text: input.text,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

export async function uploadImageColumn(input: {
  created_by: string;
  channel_id: number;
  // Public URL of the already-uploaded storage object.
  image: string;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "image",
      image: input.image,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

export async function uploadPdfColumn(input: {
  created_by: string;
  channel_id: number;
  // Media URL of the already-uploaded PDF blob (reuses the `image` field).
  image: string;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "pdf",
      image: input.image,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

export async function uploadVideoColumn(input: {
  created_by: string;
  channel_id: number;
  // Media URL of the already-uploaded video blob (reuses the `image` field).
  image: string;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "video",
      image: input.image,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

// Add a channel as a column inside another channel (Are.na-style). The column
// carries no content of its own — it links to `linked_channel_id`. Auth (owning
// the host, the linked channel being public) is enforced by the action.
export async function addChannelColumn(input: {
  created_by: string;
  channel_id: number;
  linked_channel_id: number;
}): Promise<Column> {
  const [row] = await db
    .insert(column)
    .values({
      type: "channel",
      channel_id: input.channel_id,
      linked_channel_id: input.linked_channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

export async function updateColumnTitle(column_id: number, title: string): Promise<void> {
  await db.update(column).set({ title }).where(eq(column.id, column_id));
}

export async function updateColumnDescription(
  column_id: number,
  description: string,
): Promise<void> {
  await db.update(column).set({ description }).where(eq(column.id, column_id));
}

export async function updateColumnTags(column_id: number, tags: string[]): Promise<void> {
  await db.update(column).set({ tags }).where(eq(column.id, column_id));
}

// Move a block to another channel. Only the channel_id changes, so the block
// keeps its id, created_at, title, description, tags, and content — and, for a
// url block, the screenshot cached against its URL. Returns the updated row, or
// null when the block no longer exists. Authorization (owning both channels) is
// enforced by the caller.
export async function moveColumn(column_id: number, channel_id: number): Promise<Column | null> {
  const [row] = await db
    .update(column)
    .set({ channel_id })
    .where(eq(column.id, column_id))
    .returning();
  return row ? toColumn(row) : null;
}

// Duplicate a block into another channel, leaving the source untouched. The new
// row copies every content field but gets a new channel/creator and its own
// `image` (the action passes a fresh media reference for media blocks, so the
// copy and the original don't share a media row — deleting one mustn't dangle
// the other). Authorization is enforced by the action.
export async function copyColumn(input: {
  source: Column;
  channel_id: number;
  created_by: string;
  // Media URL for the copy: a fresh media reference for media blocks, the
  // source's external URL for url/external-image blocks, or null.
  image: string | null;
}): Promise<Column> {
  const { source } = input;
  const [row] = await db
    .insert(column)
    .values({
      type: source.type,
      title: source.title,
      description: source.description,
      url: source.url,
      text: source.text,
      image: input.image,
      linked_channel_id: source.linked_channel_id,
      tags: source.tags,
      channel_id: input.channel_id,
      created_by: input.created_by,
    })
    .returning();
  return toColumn(row);
}

// Set title and/or description in one update — used to pre-fill a URL block
// from its page metadata after capture.
export async function updateColumnMeta(
  column_id: number,
  fields: { title?: string; description?: string },
): Promise<void> {
  await db.update(column).set(fields).where(eq(column.id, column_id));
}

// Partial update of a block's editable fields (title/description/text/url/image),
// returning the updated row. Used by the REST API and MCP block-edit handlers,
// which pick the allowed fields per block type before calling this. Callers must
// authorize ownership first.
export async function updateColumn(
  column_id: number,
  fields: Partial<Pick<Column, "title" | "description" | "text" | "url" | "image">>,
): Promise<Column> {
  const [row] = await db.update(column).set(fields).where(eq(column.id, column_id)).returning();
  if (!row) {
    throw new Error("Block not found.");
  }
  return toColumn(row);
}

export async function deleteColumn(column_id: number): Promise<void> {
  const [row] = await db
    .delete(column)
    .where(eq(column.id, column_id))
    .returning({ type: column.type, image: column.image, url: column.url });
  if (!row) return;
  // Drop the deleted block's media reference (no-op for external image URLs);
  // the blob is GC'd if this was its last reference.
  if (row.image) {
    await deleteMediaByUrl(row.image);
  }
  // A URL block's screenshot lives in the shared per-URL `screenshot` cache,
  // not on the column. When the last column linking this URL (across all users)
  // is gone, GC the cached screenshot and its blob too.
  if (row.type === "url" && row.url) {
    await deleteScreenshotIfUnreferenced(row.url);
  }
  // Same story for a tweet block's shared snapshot + self-hosted media.
  if (row.type === "tweet" && row.url) {
    const id = tweetIdFromUrl(row.url);
    if (id) await deleteTweetIfUnreferenced(id, row.url);
  }
}

// Drop the cached screenshot for `url` (and GC its blob) once no column
// anywhere still references that URL. No-op while any column still links it.
// ponytail: a column re-added between the count check and the delete would lose
// its cached screenshot (a re-capture, not a crash); acceptable for a GC path.
export async function deleteScreenshotIfUnreferenced(url: string): Promise<void> {
  const [stillReferenced] = await db
    .select({ id: column.id })
    .from(column)
    .where(eq(column.url, url))
    .limit(1);
  if (stillReferenced) return;
  const [dropped] = await db
    .delete(screenshot)
    .where(eq(screenshot.url, url))
    .returning({ image_url: screenshot.image_url });
  if (dropped?.image_url) {
    await deleteMediaByUrl(dropped.image_url);
  }
}

export async function getChannelColumnCount(channel_id: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(column)
    .where(eq(column.channel_id, channel_id));
  return row?.count ?? 0;
}

// Block counts for many channels in a single grouped query instead of one
// count(*) per channel. Returns a map keyed by channel id; a channel with no
// blocks is absent (callers default to 0). Backs the profile grid.
export async function getChannelColumnCounts(channelIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (channelIds.length === 0) return counts;
  const rows = await db
    .select({ channel_id: column.channel_id, count: sql<number>`count(*)::int` })
    .from(column)
    .where(inArray(column.channel_id, channelIds))
    .groupBy(column.channel_id);
  for (const r of rows) counts.set(r.channel_id, r.count);
  return counts;
}

// Save a text block's markdown, returning the updated block so the caller gets
// the freshly rendered `html` back with it (the grid card shows that, not the
// source). Null when the block no longer exists.
export async function updateColumnText(column_id: number, text: string): Promise<Column | null> {
  const [row] = await db.update(column).set({ text }).where(eq(column.id, column_id)).returning();
  return row ? toColumn(row) : null;
}
