import { SupabaseClient } from "@supabase/supabase-js";

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
  // A non-numeric route param (e.g. parseInt("foo") → NaN) is never a real id;
  // treat it as not-found instead of letting Postgres reject NaN for a bigint.
  if (!Number.isFinite(column_id)) {
    return null;
  }

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

export async function getChannelColumns(
  supabase: SupabaseClient,
  channel_id: number,
  limit?: number,
): Promise<Column[]> {
  if (limit) {
    const { data, error } = await supabase
      .from("column")
      .select("*")
      .eq("channel_id", channel_id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  const { data, error } = await supabase
    .from("column")
    .select("*")
    .eq("channel_id", channel_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data;
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
