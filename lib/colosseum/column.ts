import { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSearch } from "@/lib/utils";

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
};

// Fetch a single block by id. Returns null when it doesn't exist or RLS hides
// it (a block in a private channel the requester doesn't own), so callers can
// render a not-found state without leaking which case it was.
export async function getColumn(
  supabase: SupabaseClient,
  column_id: number,
): Promise<Column | null> {
  const { data, error } = await supabase
    .from("column")
    .select("*")
    .eq("id", column_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
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

// Escape ilike wildcards so a literal `%`/`_` in the query isn't treated as one,
// and drop the characters PostgREST uses to delimit an `.or(...)` filter so a
// search term can't break out of it.
function sanitizeSearch(term: string): string {
  return term
    .replace(/[%_]/g, (m) => `\\${m}`)
    .replace(/[(),]/g, " ")
    .trim();
}

export async function getChannelColumns(
  supabase: SupabaseClient,
  channel_id: number,
  query: ColumnQuery = {},
): Promise<Column[]> {
  const { search, type = "all", sort = "newest", limit, offset = 0 } = query;

  let builder = supabase.from("column").select("*").eq("channel_id", channel_id);

  if (type !== "all") {
    builder = builder.eq("type", type);
  }

  const term = search ? sanitizeSearch(search) : "";
  if (term) {
    const pattern = `%${term}%`;
    builder = builder.or(
      ["title", "description", "text", "url"].map((col) => `${col}.ilike.${pattern}`).join(","),
    );
  }

  switch (sort) {
    case "oldest":
      builder = builder.order("created_at", { ascending: true });
      break;
    case "title_az":
      builder = builder.order("title", { ascending: true, nullsFirst: false });
      break;
    case "title_za":
      builder = builder.order("title", { ascending: false, nullsFirst: false });
      break;
    default:
      builder = builder.order("created_at", { ascending: false });
  }

  if (limit !== undefined) {
    builder = builder.range(offset, offset + limit - 1);
  }

  const { data, error } = await builder;

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

// Blocks the user created whose title/description/text/url match `query`.
// Used by the nav search box, so capped to a handful of results. Returns []
// for an empty/whitespace-only query rather than the user's whole block list.
export async function searchUserColumns(
  supabase: SupabaseClient,
  user_id: string,
  query: string,
): Promise<Column[]> {
  const term = sanitizeSearch(query);
  if (!term) {
    return [];
  }

  const pattern = `%${term}%`;
  const { data, error } = await supabase
    .from("column")
    .select("*")
    .eq("created_by", user_id)
    .or(["title", "description", "text", "url"].map((col) => `${col}.ilike.${pattern}`).join(","))
    .limit(10);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function uploadURLColumn(
  supabase: SupabaseClient,
  column: {
    created_by: string;
    channel_id: number;
    text: string;
  },
): Promise<Column> {
  const columnData = {
    type: "url",
    url: column.text,
    channel_id: column.channel_id,
    created_by: column.created_by,
  };
  const { data, error: insertError } = await supabase
    .from("column")
    .insert(columnData) // use insert instead of upsert
    .select()
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return data;
}

export async function uploadTextColumn(
  supabase: SupabaseClient,
  column: {
    created_by: string;
    channel_id: number;
    text: string;
  },
): Promise<Column> {
  const columnData = {
    type: "text",
    text: column.text,
    channel_id: column.channel_id,
    created_by: column.created_by,
  };

  const { data, error: insertError } = await supabase
    .from("column")
    .insert(columnData) // use insert instead of upsert
    .select()
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return data;
}

export async function uploadImageColumn(
  supabase: SupabaseClient,
  column: {
    created_by: string;
    channel_id: number;
    // Public URL of the already-uploaded storage object.
    image: string;
  },
): Promise<Column> {
  const columnData = {
    type: "image",
    image: column.image,
    channel_id: column.channel_id,
    created_by: column.created_by,
  };

  const { data, error: insertError } = await supabase
    .from("column")
    .insert(columnData)
    .select()
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return data;
}

export async function updateColumnTitle(
  supabase: SupabaseClient,
  column_id: number,
  title: string,
): Promise<void> {
  const { error } = await supabase.from("column").update({ title: title }).eq("id", column_id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateColumnDescription(
  supabase: SupabaseClient,
  column_id: number,
  description: string,
) {
  const { error } = await supabase
    .from("column")
    .update({ description: description })
    .eq("id", column_id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteColumn(supabase: SupabaseClient, column_id: number): Promise<void> {
  const { error } = await supabase.from("column").delete().eq("id", column_id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getChannelColumnCount(
  supabase: SupabaseClient,
  channel_id: number,
): Promise<number> {
  const { count, error } = await supabase
    .from("column")
    .select("id", { count: "exact" })
    .eq("channel_id", channel_id);

  if (error) {
    throw new Error(error.message);
  }

  if (count === null) {
    throw new Error("Count for columns was null.");
  }

  return count;
}

export async function updateColumnText(supabase: SupabaseClient, column_id: number, text: string) {
  const { error } = await supabase
    .from("column")
    .update({ text: text })
    .eq("id", column_id)
    .select();

  if (error) {
    throw new Error(error.message);
  }
}
