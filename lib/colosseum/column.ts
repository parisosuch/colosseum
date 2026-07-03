import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { column } from "@/lib/db/schema";
import { sanitizeSearch } from "@/lib/utils";
import { deleteMediaByUrl } from "./blob";

export type Column = {
  id: number;
  created_at: string;
  type: "url" | "text" | "image";
  title?: string;
  description?: string;
  url?: string;
  text?: string;
  image?: string;
  created_by: string;
  channel_id: number;
  tags: string[];
};

type ColumnRow = typeof column.$inferSelect;
function toColumn(row: ColumnRow): Column {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    type: row.type,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    url: row.url ?? undefined,
    text: row.text ?? undefined,
    image: row.image ?? undefined,
    created_by: row.created_by,
    channel_id: row.channel_id,
    tags: row.tags,
  };
}

// Fetch a single block by id. Returns null when it doesn't exist. Visibility is
// NOT enforced here — callers authorize via the block's channel first.
export async function getColumn(column_id: number): Promise<Column | null> {
  // A non-numeric route param (e.g. parseInt("foo") → NaN) is never a real id;
  // treat it as not-found instead of letting Postgres reject NaN for a bigint.
  if (!Number.isFinite(column_id)) {
    return null;
  }
  const [row] = await db.select().from(column).where(eq(column.id, column_id)).limit(1);
  return row ? toColumn(row) : null;
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
};

// Callers must authorize the channel's visibility before calling this (see the
// channel page and authorizeChannelRead); it returns every block in the channel.
export async function getChannelColumns(
  channel_id: number,
  query: ColumnQuery = {},
): Promise<Column[]> {
  const { search, type = "all", sort = "newest", limit, offset = 0 } = query;

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

  return rows.map(toColumn);
}

// Blocks the user created whose title/description/text/url or a tag match
// `query`. Used by the nav search box, so capped to a handful of results.
// Returns [] for an empty/whitespace-only query rather than the whole list.
export async function searchUserColumns(user_id: string, query: string): Promise<Column[]> {
  const term = sanitizeSearch(query);
  if (!term) {
    return [];
  }

  const pattern = `%${term}%`;
  const tag = term.replace(/["\\]/g, "");
  const rows = await db
    .select()
    .from(column)
    .where(
      and(
        eq(column.created_by, user_id),
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
  return rows.map(toColumn);
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
    .returning({ image: column.image });
  // Drop the deleted block's media reference (no-op for external image URLs);
  // the blob is GC'd if this was its last reference.
  if (row?.image) {
    await deleteMediaByUrl(row.image);
  }
}

export async function getChannelColumnCount(channel_id: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(column)
    .where(eq(column.channel_id, channel_id));
  return row?.count ?? 0;
}

export async function updateColumnText(column_id: number, text: string): Promise<void> {
  await db.update(column).set({ text }).where(eq(column.id, column_id));
}
