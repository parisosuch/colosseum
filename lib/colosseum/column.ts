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
  channel_id: number
): Promise<Column[]> {
  const { data, error } = await supabase
    .from("column")
    .select("*")
    .eq("channel_id", channel_id)
    .order("created_at");

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function uploadTextAreaColumn(
  supabase: SupabaseClient,
  column: {
    created_by: string;
    channel_id: number;
    text: string;
  }
): Promise<Column> {
  let columnData;

  if (isURL(column.text)) {
    columnData = {
      type: "url",
      url: column.text,
      created_by: column.created_by,
      channel_id: column.channel_id,
    };
  } else {
    columnData = {
      type: "text",
      url: column.text,
      created_by: column.created_by,
      channel_id: column.channel_id,
    };
  }

  const { data, error } = await supabase
    .from("column")
    .upsert(columnData)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
