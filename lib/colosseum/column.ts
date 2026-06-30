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
};

// A channel a block is connected to — the shape needed to list/manage a block's
// connections without pulling the full Channel row.
export type BlockChannel = {
  id: number;
  title: string;
  private: boolean;
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

// Blocks connected to a channel, newest connection first. Backed by the
// get_channel_blocks function so the block_channel join (and its ordering) lives
// in the database rather than relying on PostgREST embedding.
export async function getChannelColumns(
  supabase: SupabaseClient,
  channel_id: number,
  limit?: number,
): Promise<Column[]> {
  let query = supabase.rpc("get_channel_blocks", { p_channel_id: channel_id });
  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

// Create a block and connect it to a channel in one transaction (create_block
// RPC). created_by is taken from the authenticated session by the function.
export async function createBlock(
  supabase: SupabaseClient,
  params: {
    type: "url" | "text" | "image";
    channel_id: number;
    url?: string;
    text?: string;
    image?: string;
  },
): Promise<Column> {
  const { data, error } = await supabase.rpc("create_block", {
    p_type: params.type,
    p_channel_id: params.channel_id,
    p_url: params.url ?? null,
    p_text: params.text ?? null,
    p_image: params.image ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Column;
}

// Channels a block is connected to (only those visible to the requester).
export async function getBlockChannels(
  supabase: SupabaseClient,
  block_id: number,
): Promise<BlockChannel[]> {
  const { data, error } = await supabase
    .from("block_channel")
    .select("channel:channel(id, title, private)")
    .eq("block_id", block_id);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => row.channel as unknown as BlockChannel);
}

export async function connectBlockToChannel(
  supabase: SupabaseClient,
  block_id: number,
  channel_id: number,
): Promise<void> {
  const { error } = await supabase.from("block_channel").insert({ block_id, channel_id });

  if (error) {
    throw new Error(error.message);
  }
}

export async function disconnectBlockFromChannel(
  supabase: SupabaseClient,
  block_id: number,
  channel_id: number,
): Promise<void> {
  const { error } = await supabase
    .from("block_channel")
    .delete()
    .eq("block_id", block_id)
    .eq("channel_id", channel_id);

  if (error) {
    throw new Error(error.message);
  }
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
    .from("block_channel")
    .select("block_id", { count: "exact", head: true })
    .eq("channel_id", channel_id);

  if (error) {
    throw new Error(error.message);
  }

  if (count === null) {
    throw new Error("Count for channel blocks was null.");
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
