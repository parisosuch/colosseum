import { SupabaseClient } from "@supabase/supabase-js";
import { isURL } from "../utils";

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

export async function getChannelColumns(
  supabase: SupabaseClient,
  channel_id: number,
  limit?: number
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

export async function uploadTextAreaColumn(
  supabase: SupabaseClient,
  column: {
    created_by: string;
    channel_id: string;
    text: string;
  }
): Promise<Column> {
  const columnIsURL = isURL(column.text);
  let columnData;

  if (columnIsURL) {
    const urlText = column.text.startsWith("https://")
      ? column.text
      : "https://" + column.text;

    columnData = {
      type: "url",
      url: urlText,
      channel_id: parseInt(column.channel_id),
      created_by: column.created_by,
    };
  } else {
    columnData = {
      type: "text",
      text: column.text,
      channel_id: parseInt(column.channel_id),
      created_by: column.created_by,
    };
  }

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

export async function updateColumnTitle(
  supabase: SupabaseClient,
  column_id: number,
  title: string
): Promise<void> {
  const { error } = await supabase
    .from("column")
    .update({ title: title })
    .eq("id", column_id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateColumnDescription(
  supabase: SupabaseClient,
  column_id: number,
  description: string
) {
  const { error } = await supabase
    .from("column")
    .update({ description: description })
    .eq("id", column_id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteColumn(
  supabase: SupabaseClient,
  column_id: number
): Promise<void> {
  const { error } = await supabase.from("column").delete().eq("id", column_id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getChannelColumnCount(
  supabase: SupabaseClient,
  channel_id: number
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

export async function updateColumnText(
  supabase: SupabaseClient,
  column_id: number,
  text: string
) {
  const { error } = await supabase
    .from("column")
    .update({ text: text })
    .eq("id", column_id)
    .select();

  if (error) {
    throw new Error(error.message);
  }
}
